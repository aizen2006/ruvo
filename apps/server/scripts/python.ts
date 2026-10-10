/**
 * The Python that runs RUVO's fetch service natively (infra/scrapling/server.py), for setup, the doctor and
 * `bun run dev`: SCRAPLING_PYTHON when set; otherwise the venv setup creates with uv, or the system's Python.
 */
import { $ } from "bun";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Where `bun run setup` installs Scrapling with uv when no Python has it (git-ignored). */
const VENV = join(import.meta.dir, "..", "..", "..", ".venv");
const venvProgram = (name: string) => (process.platform === "win32" ? join(VENV, "Scripts", `${name}.exe`) : join(VENV, "bin", name));

export interface FoundPython {
  python: string;
  /** Scrapling's version, when this Python can run the fetch service. */
  scrapling?: string;
  /** Why it can't, otherwise: the last line of the import's error. */
  error?: string;
}

/** SCRAPLING_PYTHON when set; otherwise setup's venv if it has Scrapling, else `python` on Windows and `python3` elsewhere. */
export async function findPython(configured: string | undefined): Promise<FoundPython> {
  if (configured) return scraplingIn(configured);
  const venv = existsSync(venvProgram("python")) ? await scraplingIn(venvProgram("python")) : undefined;
  return venv?.scrapling ? venv : scraplingIn(process.platform === "win32" ? "python" : "python3");
}

async function scraplingIn(python: string): Promise<FoundPython> {
  // scrapling[all] also brings the service's web server (starlette, uvicorn).
  const res = await $`${python} -c "import scrapling, starlette, uvicorn; print(scrapling.__version__)"`.quiet().nothrow();
  if (res.exitCode === 0) return { python, scrapling: res.text().trim() };
  return { python, error: res.stderr.toString().trim().split("\n").at(-1) };
}

/**
 * Creates setup's venv with uv, with the Python and Scrapling versions infra/scrapling/Dockerfile runs, and Scrapling's
 * browsers. uv downloads that Python when this machine lacks it, so neither PEP 668 nor macOS's Python 3.9 is in the way.
 */
export async function createVenv() {
  await $`uv venv --allow-existing --python 3.12 ${VENV}`;
  await $`uv pip install --python ${venvProgram("python")} ${"scrapling[all]==0.4.15"}`;
  await $`${venvProgram("scrapling")} install`;
}
