import { expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const SRC = join(import.meta.dir, "../src");
/** Folders below the run pipeline. They take run and item types from core/, so they never import the pipeline. */
const LOWER = new Set(["core", "adapters", "fetch", "llm", "decide", "extract", "recipes", "repair", "search"]);
const PIPELINE = new Set(["runs", "execute"]);

/** Every relative import in src/, static or dynamic, as importing file → imported path, both from src/. */
function imports() {
  const edges: Array<{ from: string; to: string }> = [];
  for (const file of new Glob("**/*.ts").scanSync(SRC)) {
    const from = file.replaceAll("\\", "/");
    for (const [, spec] of readFileSync(join(SRC, file), "utf8").matchAll(/(?:from|import)\s*\(?\s*["'](\.\.?\/[^"']+)["']/g)) {
      edges.push({ from, to: relative(SRC, join(SRC, dirname(file), spec!)).replaceAll("\\", "/") });
    }
  }
  return edges;
}

test("lower layers never import runs/ or execute/", () => {
  const folder = (path: string) => path.split("/")[0]!;
  const upward = imports()
    .filter((e) => LOWER.has(folder(e.from)) && PIPELINE.has(folder(e.to)))
    .map((e) => `${e.from} → ${e.to}`);
  expect(upward).toEqual([]);
});
