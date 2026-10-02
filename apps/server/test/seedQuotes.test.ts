import { describe, expect, test } from "bun:test";
import type { FieldSpec } from "@repo/contracts";
import { readFileSync } from "node:fs";
import { replayRecipe } from "../src/recipes/replay";
import { recipeFromExample } from "../src/recipes/seed";

const html = readFileSync(new URL("./fixtures/html/workable-rendered.html", import.meta.url), "utf8");
const url = "https://apply.workable.com/huggingface/";
const field = (name: string, catalogKey: FieldSpec["catalogKey"], type: FieldSpec["type"] = "string"): FieldSpec => ({ name, catalogKey, type, required: true, description: name });

describe("recipeFromExample with overlapping quotes", () => {
  test('a short quote inside another value ("Remote" in "... EMEA Remote") is read from its own element', () => {
    const def = recipeFromExample(html, url, [field("title", "title"), field("url", "url", "url"), field("remote", "remote")], [
      { name: "title", quote: "Senior Open-Source Python Engineer, ML Developer Tools - EMEA Remote" },
      { name: "url", quote: "/huggingface/j/DB4D7C0EC8/" },
      { name: "remote", quote: "Remote" },
    ])!;
    const rows = replayRecipe(html, url, def).rows;

    expect(rows.map((r) => r.title)).toEqual([
      "Senior Open-Source Python Engineer, ML Developer Tools - EMEA Remote",
      "Senior Open-Source Python Engineer, ML Developer Tools - US Remote",
      "Senior Machine Learning Engineer, Voice Agents - EMEA Remote",
      "Low-Level Senior Software Engineer, Xet Storage - US Remote",
      "Low-level Senior Software Engineer, Xet Storage - EMEA Remote",
      "Open-Source Machine Learning Engineer - US Remote",
      "Open-Source Machine Learning Engineer - EMEA Remote",
      "Wild Card",
    ]);
    expect(rows.map((r) => r.remote)).toEqual(Array(8).fill("Remote"));
  });
});
