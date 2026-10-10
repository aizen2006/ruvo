/**
 * The document sandbox with real Docker. `bun run test:sandbox` builds the image and runs this with
 * RUVO_SANDBOX_TESTS=1; the normal test run, which needs only Postgres, skips it.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDocparse, DOCPARSE_IMAGE, DocparseError, dockerTransport } from "../src/documents/sandbox";

/** The sandbox, but each run hangs before it reads its document (docparse's test-only hook). */
const HUNG_IMAGE = "ruvo-docparse-hung";

const docker = (...args: string[]) => Bun.spawnSync(["docker", ...args], { stdout: "pipe", stderr: "pipe" });
const failure = async (run: Promise<unknown>) => (await run.catch((e: unknown) => e)) as DocparseError;

/** A one-page PDF with a line of Helvetica text. */
function tinyPdf(text: string): Uint8Array {
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.7\n";
  const offsets = objects.map((body, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

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
