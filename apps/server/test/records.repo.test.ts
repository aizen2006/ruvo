import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "../src/db/client";
import { getRecordWithEvidence } from "../src/db/repos/records";
import { evidence, records } from "../src/db/schema";
import { savePage } from "../src/fetch/pageCache";
import { insertRun, resetDb } from "./helpers/db";

beforeEach(resetDb);

describe("getRecordWithEvidence", () => {
  test("says how each evidence page was fetched", async () => {
    const run = await insertRun();
    const [record] = await db.insert(records).values({ runId: run.id, sourceId: "src", itemKey: "a", data: { title: "Engineer" }, status: "valid" }).returning();
    const url = "https://shop.example/jobs/1";
    const page = await savePage({ url, finalUrl: url, via: "stealth", status: 200, contentType: "text/html", body: "<h1>Engineer</h1>" });
    const base = { recordId: record!.id, method: "DOM" as const, sourceUrl: url, snippet: "Engineer", verified: true, confidence: 1 };
    await db.insert(evidence).values([
      { ...base, field: "title", value: "Engineer", pageId: page.id, locator: { kind: "css", value: "h1" } },
      { ...base, field: "url", value: url, method: "DERIVED", pageId: null, locator: { kind: "derived", value: "url" } },
    ]);

    const { evidence: found } = await getRecordWithEvidence(run.id, record!.id);
    expect(found.find((e) => e.field === "title")?.fetchedVia).toBe("stealth");
    // No page, no fetch method.
    expect(found.find((e) => e.field === "url")).not.toHaveProperty("fetchedVia");
  });
});
