import { afterAll, describe, expect, test } from "bun:test";
import { loadEnv } from "../src/config/envSchema";
import { createDocparse, DocparseError, serviceTransport, type DocparseResult, type DocparseTransport } from "../src/documents/sandbox";

const clean: DocparseResult = {
  verdict: "clean",
  reason: null,
  type: "csv",
  flags: [],
  meta: { encoding: "utf-8", delimiter: ",", columns: ["company", "city"], rows: 1 },
  capped: false,
  text: null,
  pageStarts: null,
  tables: [{ name: null, headers: ["company", "city"], rows: [{ row: 2, values: ["Acme", "Paris"] }] }],
};
const document = new TextEncoder().encode("company,city\nAcme,Paris\n");
const failure = async (run: Promise<unknown>) => (await run.catch((e: unknown) => e)) as DocparseError;

describe("the document sandbox client", () => {
  test("sends the document and whether to parse it, and returns the checked result", async () => {
    let sent: { document: Uint8Array; parse: boolean } | undefined;
    const docparse = createDocparse(async (document, parse) => {
      sent = { document, parse };
      return JSON.stringify(clean);
    });
    expect(await docparse.run(document, { parse: true })).toEqual(clean);
    expect(sent).toEqual({ document, parse: true });
  });

  test("a reply that isn't a result is a failure", async () => {
    for (const reply of ["not json", JSON.stringify({ ...clean, verdict: "fine" })]) {
      const error = await failure(createDocparse(async () => reply).run(document, { parse: false }));
      expect(error).toBeInstanceOf(DocparseError);
      expect(error.kind).toBe("failed");
    }
  });

  test("a transport's error is a failure that says why", async () => {
    const error = await failure(createDocparse(() => Promise.reject(new Error("its container exited with 125"))).run(document, { parse: false }));
    expect(error.kind).toBe("failed");
    expect(error.message).toContain("exited with 125");
  });

  test("a run that takes too long is stopped", async () => {
    let stopped = false;
    const hangs: DocparseTransport = (_document, _parse, signal) =>
      new Promise((_, reject) =>
        signal.addEventListener("abort", () => {
          stopped = true;
          reject(signal.reason);
        }),
      );
    const error = await failure(createDocparse(hangs, 50).run(document, { parse: true }));
    expect(error.kind).toBe("timeout");
    expect(stopped).toBe(true);
  });

  test("cancelling the run rejects with the cancellation, not a sandbox error", async () => {
    const controller = new AbortController();
    const hangs: DocparseTransport = (_document, _parse, signal) =>
      new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
    setTimeout(() => controller.abort(), 20);
    const error = await failure(createDocparse(hangs).run(document, { parse: true, signal: controller.signal }));
    expect(error).not.toBeInstanceOf(DocparseError);
    expect((error as Error).name).toBe("AbortError");
  });

  test("reads at most two documents at once", async () => {
    let running = 0;
    let most = 0;
    const docparse = createDocparse(async () => {
      most = Math.max(most, ++running);
      await Bun.sleep(10);
      running--;
      return JSON.stringify(clean);
    });
    await Promise.all(Array.from({ length: 5 }, () => docparse.run(document, { parse: false })));
    expect(most).toBe(2);
  });
});

describe("the docparse service transport", () => {
  let last: { url: string; body: string } | undefined;
  /** A stand-in for docparse serve. */
  const service = Bun.serve({
    port: 0,
    async fetch(req) {
      last = { url: req.url, body: await req.text() };
      if (last.body === "slow") return Response.json({ error: "timeout", message: "took longer than 30 s" }, { status: 504 });
      if (last.body === "broken") return Response.json({ error: "failed", message: "exited with -9" }, { status: 500 });
      return Response.json(clean);
    },
  });
  afterAll(() => service.stop(true));
  const docparse = createDocparse(`http://127.0.0.1:${service.port}`);
  const run = (body: string, parse: boolean) => docparse.run(new TextEncoder().encode(body), { parse });

  test("posts the document, with ?parse=1 to parse it", async () => {
    expect(await run("company,city", true)).toEqual(clean);
    expect(last).toEqual({ url: `http://127.0.0.1:${service.port}/?parse=1`, body: "company,city" });
    await run("company,city", false);
    expect(last!.url).toBe(`http://127.0.0.1:${service.port}/`);
  });

  test("the service's timeout and failures are sandbox errors", async () => {
    expect((await failure(run("slow", true))).kind).toBe("timeout");
    const error = await failure(run("broken", true));
    expect(error.kind).toBe("failed");
    expect(error.message).toContain("HTTP 500");
  });

  test("an unreachable service is a failure", async () => {
    const down = Bun.serve({ port: 0, fetch: () => new Response() });
    const url = `http://127.0.0.1:${down.port}`;
    await down.stop(true);
    const error = await failure(createDocparse(serviceTransport(url)).run(document, { parse: false }));
    expect(error.kind).toBe("failed");
    expect(error.message).toContain("unreachable");
  });
});

describe("DOCPARSE", () => {
  const DATABASE_URL = "postgres://u:p@localhost:5432/db";

  test("is docker unless it is the docparse service's URL", () => {
    expect(loadEnv({ DATABASE_URL }).DOCPARSE).toBe("docker");
    expect(loadEnv({ DATABASE_URL, DOCPARSE: "" }).DOCPARSE).toBe("docker");
    expect(loadEnv({ DATABASE_URL, DOCPARSE: "http://docparse:8100" }).DOCPARSE).toBe("http://docparse:8100");
    expect(() => loadEnv({ DATABASE_URL, DOCPARSE: "podman" })).toThrow(/DOCPARSE/);
    expect(() => loadEnv({ DATABASE_URL, DOCPARSE: "file:///var/run/docker.sock" })).toThrow(/DOCPARSE/);
  });
});
