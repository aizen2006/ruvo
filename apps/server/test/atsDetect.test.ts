import { beforeEach, describe, expect, test } from "bun:test";
import type { Ats } from "../src/adapters/ats";
import { autoDetectCompanies, detectBoard, slugVariants } from "../src/plan/atsDetect";
import { listRegistry } from "../src/plan/registry";
import { resetDb } from "./helpers/db";

beforeEach(resetDb);

describe("slugVariants", () => {
  test.each([
    ["Scale AI", ["scaleai", "scale-ai", "scale"]],
    ["Hugging Face", ["huggingface", "hugging-face", "hugging"]],
    ["Acme Labs, Inc.", ["acmelabsinc", "acme-labs-inc", "acme"]],
    ["Figma", ["figma"]],
  ])("%s", (name, expected) => {
    expect(slugVariants(name)).toEqual(expected);
  });
});

/** A fake ATS world: only the listed ats/slug boards exist. */
const probe = (boards: Record<string, number>) => async (ats: Ats, slug: string) => {
  const count = boards[`${ats}:${slug}`];
  return count === undefined ? null : { ats, slug, jobCount: count };
};

describe("detectBoard", () => {
  test("tries slug variants in order and picks the busiest board for a slug", async () => {
    const hit = await detectBoard("Scale AI", { userAgent: "t", probe: probe({ "ashby:scale": 3, "greenhouse:scaleai": 0, "lever:scale": 40 }) });
    expect(hit).toEqual({ ats: "lever", slug: "scale", jobCount: 40 });
  });

  test("returns null when no board has postings", async () => {
    expect(await detectBoard("Nowhere Co", { userAgent: "t", probe: probe({}) })).toBeNull();
  });
});

describe("autoDetectCompanies", () => {
  test("records detected boards in the registry and reports the rest", async () => {
    const result = await autoDetectCompanies(["Figma", "Ghost Corp"], { userAgent: "t", probe: probe({ "greenhouse:figma": 120 }) });
    expect(result.missing).toEqual(["Ghost Corp"]);
    const [row] = await listRegistry();
    expect(row).toMatchObject({ name: "Figma", ats: "greenhouse", slug: "figma", origin: "auto_detected", jobCount: 120, tags: [] });
  });
});
