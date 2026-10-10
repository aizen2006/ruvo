/**
 * The document sandbox with real Docker. `bun run test:sandbox` builds the image and runs this with
 * RUVO_SANDBOX_TESTS=1; the normal test run, which needs only Postgres, skips it.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDocparse, DOCPARSE_IMAGE, DocparseError, dockerTransport } from "../src/documents/sandbox";
import { tinyPdf } from "../src/documents/tinyPdf";

/** The sandbox, but each run hangs before it reads its document (docparse's test-only hook). */
const HUNG_IMAGE = "ruvo-docparse-hung";

const docker = (...args: string[]) => Bun.spawnSync(["docker", ...args], { stdout: "pipe", stderr: "pipe" });
const failure = async (run: Promise<unknown>) => (await run.catch((e: unknown) => e)) as DocparseError;

describe.skipIf(process.env.RUVO_SANDBOX_TESTS !== "1")("the document sandbox in Docker", () => {
  beforeAll(() => {
    const build = Bun.spawnSync(["docker", "build", "-t", HUNG_IMAGE, "-"], {
      stdin: new TextEncoder().encode(`FROM ${DOCPARSE_IMAGE}\nENV DOCPARSE_TEST_SLEEP=600\n`),
      stderr: "pipe",
    });
    if (build.exitCode !== 0) throw new Error(`Couldn't build ${HUNG_IMAGE}: ${build.stderr.toString()}`);
  });
  afterAll(() => docker("rmi", "-f", HUNG_IMAGE));

  test("a clean PDF is scanned and parsed in a container of its own", async () => {
    const result = await createDocparse("docker").run(tinyPdf("Hello from the sandbox"), { parse: true });
    expect(result).toMatchObject({ verdict: "clean", type: "pdf", flags: [], text: "Hello from the sandbox", pageStarts: [0] });
    expect(result.meta.pages).toBe(1);
  }, 60_000);

  test("a run that hangs is stopped at the timeout, and its container is removed", async () => {
    const started = Date.now();
    const error = await failure(createDocparse(dockerTransport(HUNG_IMAGE), 3_000).run(tinyPdf("Hello"), { parse: true }));
    expect(error).toBeInstanceOf(DocparseError);
    expect(error.kind).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(docker("ps", "-a", "-q", "--filter", `ancestor=${HUNG_IMAGE}`).stdout.toString().trim()).toBe("");
  }, 60_000);

  test("a missing image is a failure that says so", async () => {
    const error = await failure(createDocparse(dockerTransport("ruvo-docparse-missing")).run(tinyPdf("Hello"), { parse: false }));
    expect(error.kind).toBe("failed");
    expect(error.message).toContain("No such image");
  }, 60_000);
});
