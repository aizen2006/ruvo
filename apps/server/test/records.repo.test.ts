import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { getRecordWithEvidence } from "../src/db/repos/records";
import { evidence, pages, records } from "../src/db/schema";
import { savePage } from "../src/fetch/pageCache";
import { insertRun, resetDb } from "./helpers/db";

beforeEach(resetDb);

describe("getRecordWithEvidence", () => {
  test("says how and when each evidence page was fetched", async () => {
    const run = await insertRun();
    const [record] = await db.insert(records).values({ runId: run.id, sourceId: "src", itemKey: "a", data: { title: "Engineer" }, status: "valid" }).returning();
    const url = "https://shop.example/jobs/1";
    const page = await savePage({ url, finalUrl: url, via: "stealth", status: 200, contentType: "text/html", body: "<h1>Engineer</h1>" });
    // A stored page read again later: the evidence is written now, the page was fetched before.
    const fetchedAt = new Date("2026-09-01T08:00:00.000Z");
    await db.update(pages).set({ fetchedAt }).where(eq(pages.id, page.id));
    const base = { recordId: record!.id, method: "DOM" as const, sourceUrl: url, snippet: "Engineer", verified: true, confidence: 1 };
    await db.insert(evidence).values([
      { ...base, field: "title", value: "Engineer", pageId: page.id, locator: { kind: "css", value: "h1" } },
      { ...base, field: "url", value: url, method: "DERIVED", pageId: null, locator: { kind: "derived", value: "url" } },
    ]);

    const { evidence: found } = await getRecordWithEvidence(run.id, record!.id);
    expect(found.find((e) => e.field === "title")).toMatchObject({ fetchedVia: "stealth", fetchedAt: fetchedAt.toISOString() });
    // No page, no fetch method or date: the receipt shows when the value was recorded.
    expect(found.find((e) => e.field === "url")).not.toHaveProperty("fetchedVia");
    expect(found.find((e) => e.field === "url")).not.toHaveProperty("fetchedAt");
  });
});
