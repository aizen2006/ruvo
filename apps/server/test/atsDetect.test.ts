import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { ATS_BOARD_URL, type Ats } from "../src/domains/jobs/adapters/ats";
import { autoDetectCompanies, detectBoard, slugVariants } from "../src/domains/jobs/atsDetect";
import { probeBoard } from "../src/domains/jobs/atsProbe";
import { listRegistry } from "../src/domains/jobs/registry";
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

describe("probeBoard", () => {
  test("refuses a board on a private address without asking it", async () => {
    let asked = 0;
    using board = Bun.serve({
      port: 0,
      fetch: () => {
        asked++;
        return Response.json({ jobs: [{}, {}] });
      },
    });
    const boardUrl = spyOn(ATS_BOARD_URL, "greenhouse").mockReturnValue(`http://127.0.0.1:${board.port}/v1/boards/acme/jobs`);
    try {
      expect(await probeBoard("greenhouse", "acme", { userAgent: "t" })).toBeNull();
      expect(asked).toBe(0);
    } finally {
      boardUrl.mockRestore();
    }
  });
});
