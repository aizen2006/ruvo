import { randomUUID } from "node:crypto";
import { z } from "zod";
import { readCapped } from "../fetch/readCapped";
import { createSemaphore } from "../libs/limit";

/** The document sandbox's image, built from infra/docparse. */
export const DOCPARSE_IMAGE = "ruvo-docparse";

/**
 * A container per document: no network, a read-only filesystem with a small /tmp, no capabilities or privilege gain,
 * the user nobody, and memory, CPU and process limits. The document goes in on stdin (-i, never -t). The sandbox
 * suite runs with the same flags (test:sandbox in package.json).
 */
const SANDBOX = [
  "--rm", "-i", "--pull", "never", "--network", "none", "--read-only", "--tmpfs", "/tmp:size=64m", "--cap-drop", "ALL",
  "--security-opt", "no-new-privileges", "--pids-limit", "64", "--memory", "512m", "--cpus", "1", "--user", "65534",
];
/** docparse's reply is as untrusted as the document it read, so it is size-capped and checked. */
const MAX_REPLY_BYTES = 64 * 1024 * 1024;
const MAX_ERROR_BYTES = 64 * 1024;

const MetaText = z.string().nullable().optional();
/** What a document says about itself; the fields set depend on its type (see infra/docparse/docparse.py). */
const DocumentMetaSchema = z.object({
  title: MetaText,
  author: MetaText,
  subject: MetaText,
  keywords: MetaText,
  created: MetaText,
  modified: MetaText,
  pages: z.number().int().nonnegative().optional(),
  sheets: z
    .array(z.object({ name: z.string().nullable(), hidden: z.boolean(), rows: z.number().int().nullable(), columns: z.number().int().nullable() }))
    .optional(),
  encoding: z.string().optional(),
  delimiter: z.string().optional(),
  shape: z.enum(["array", "object", "lines"]).optional(),
  columns: z.array(z.string()).optional(),
  rows: z.number().int().nonnegative().nullable().optional(),
});

/** docparse's result, described at the top of infra/docparse/docparse.py. */
const DocparseResultSchema = z.object({
  verdict: z.enum(["clean", "risky", "rejected"]),
  reason: z.string().nullable(),
  type: z.enum(["pdf", "xlsx", "csv", "json", "html"]).nullable(),
  flags: z.array(z.string()),
  meta: DocumentMetaSchema,
  capped: z.boolean(),
  text: z.string().nullable(),
  /** Where each page starts in `text`, in UTF-16 code units, as string indexes count. */
  pageStarts: z.array(z.number().int().nonnegative()).nullable(),
  tables: z
    .array(
      z.object({
        name: z.string().nullable(),
        headers: z.array(z.string()),
        rows: z.array(z.object({ row: z.number().int().positive(), values: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])) })),
      }),
    )
    .nullable(),
});
export type DocparseResult = z.infer<typeof DocparseResultSchema>;

/** The sandbox gave no verdict: it took too long and was stopped, or it failed to run or to reply. */
export class DocparseError extends Error {
  constructor(
    readonly kind: "timeout" | "failed",
    message: string,
  ) {
    super(message);
    this.name = "DocparseError";
  }
}

/** Runs docparse once on a document and returns its reply, unchecked. Aborting `signal` stops the run. */
export type DocparseTransport = (document: Uint8Array, parse: boolean, signal: AbortSignal) => Promise<string>;

export interface Docparse {
  /** The sandbox's verdict on a document and, when it is clean and `parse` is set, its text or rows. */
  run(document: Uint8Array, opts: { parse: boolean; signal?: AbortSignal }): Promise<DocparseResult>;
}

/**
 * The document sandbox. `via` is DOCPARSE's value: "docker", for a container per document, or the docparse service's
 * URL; tests pass a transport. At most two documents are read at once, and each run is stopped after `timeoutMs`.
 */
export function createDocparse(via: string | DocparseTransport, timeoutMs = 30_000): Docparse {
  const transport = typeof via === "function" ? via : via === "docker" ? dockerTransport() : serviceTransport(via);
  const limit = createSemaphore(2);
  return {
    run: (document, { parse, signal }) =>
      limit(async () => {
        signal?.throwIfAborted();
        const timeout = AbortSignal.timeout(timeoutMs);
        let reply: string;
        try {
          reply = await transport(document, parse, signal ? AbortSignal.any([signal, timeout]) : timeout);
        } catch (err) {
          signal?.throwIfAborted();
          if (timeout.aborted) throw new DocparseError("timeout", `Reading a document took over ${timeoutMs / 1000} s, so it was stopped`);
          throw err instanceof DocparseError ? err : new DocparseError("failed", `The document sandbox failed: ${(err as Error).message}`);
        }
        try {
          return DocparseResultSchema.parse(JSON.parse(reply));
        } catch (err) {
          throw new DocparseError("failed", `The document sandbox's reply isn't a result (is the ${DOCPARSE_IMAGE} image current?): ${(err as Error).message.slice(0, 300)}`);
        }
      }),
  };
}

/** A container per document. On abort the container itself is removed, as stopping the docker CLI would leave it running. */
export function dockerTransport(image = DOCPARSE_IMAGE): DocparseTransport {
  return async (document, parse, signal) => {
    signal.throwIfAborted();
    const name = `ruvo-docparse-${randomUUID()}`;
    const docker = Bun.spawn(["docker", "run", "--name", name, ...SANDBOX, image, ...(parse ? ["--parse"] : [])], {
      stdin: document,
      stdout: "pipe",
      stderr: "pipe",
    });
    let removed: Promise<number> | undefined;
    const stop = () => {
      removed ??= Bun.spawn(["docker", "rm", "-f", name], { stdout: "ignore", stderr: "ignore" }).exited;
      docker.kill();
    };
    signal.addEventListener("abort", stop, { once: true });
    try {
      const [reply, errors, code] = await Promise.all([
        readCapped(new Response(docker.stdout), MAX_REPLY_BYTES, "the document sandbox"),
        readCapped(new Response(docker.stderr), MAX_ERROR_BYTES, "the document sandbox"),
        docker.exited,
      ]);
      if (code !== 0) throw new Error(`its container exited with ${code}: ${errors.trim().slice(-300)}`);
      return reply;
    } catch (err) {
      if (docker.exitCode === null) stop(); // still running: its reply went over the cap
      throw err;
    } finally {
      signal.removeEventListener("abort", stop);
      await removed;
    }
  };
}

/** docparse serve, for a worker that runs in Docker itself; it reads each document in a fresh process and stops it at its own timeout. */
export function serviceTransport(baseUrl: string): DocparseTransport {
  return async (document, parse, signal) => {
    let res: Response;
    try {
      res = await fetch(new URL(parse ? "/?parse=1" : "/", baseUrl), { method: "POST", body: document, signal });
    } catch (err) {
      if (signal.aborted) throw err;
      throw new DocparseError("failed", `The docparse service at ${baseUrl} is unreachable: ${(err as Error).message}`);
    }
    const reply = await readCapped(res, MAX_REPLY_BYTES, baseUrl);
    if (res.status === 504) throw new DocparseError("timeout", "The docparse service stopped a document that took too long to read");
    if (!res.ok) throw new Error(`the docparse service at ${baseUrl} answered HTTP ${res.status}: ${reply.slice(0, 300)}`);
    return reply;
  };
}
