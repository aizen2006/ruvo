import { beforeEach, describe, expect, test } from "bun:test";
import { curatedCompanies, listRegistry, syncCuratedRegistry } from "../src/plan/registry";
import { resetDb } from "./helpers/db";

beforeEach(resetDb);

describe("company registry", () => {
  test("the curated list is valid and non-trivial", () => {
    const companies = curatedCompanies();
    expect(companies.length).toBeGreaterThanOrEqual(12);
    expect(new Set(companies.map((c) => `${c.ats}/${c.slug}`)).size).toBe(companies.length);
  });

  test("sync is idempotent", async () => {
    await syncCuratedRegistry();
    await syncCuratedRegistry();
    const rows = await listRegistry();
    expect(rows).toHaveLength(curatedCompanies().length);
    expect(rows.every((r) => r.origin === "curated" && r.tags.length > 0)).toBe(true);
  });
});
