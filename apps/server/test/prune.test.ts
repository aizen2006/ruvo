import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { pruneStorage } from "../src/db/prune";
import { evidence, llmCalls, pages, records } from "../src/db/schema";
import { insertRun, resetDb } from "./helpers/db";

beforeEach(resetDb);

const DAY = 86_400_000;
const page = (url: string, ageDays: number) => ({
  url,
  finalUrl: url,
  host: "example.com",
  via: "http" as const,
  status: 200,
  contentHash: url,
  body: "<html>page</html>",
  bytes: 17,
  fetchedAt: new Date(Date.now() - ageDays * DAY),
});

describe("pruneStorage", () => {
  test("deletes only old pages that no record cites", async () => {
    const [cited, oldUnused, recentUnused] = await db
      .insert(pages)
      .values([page("https://example.com/cited", 60), page("https://example.com/old", 60), page("https://example.com/new", 1)])
      .returning({ id: pages.id });
    const run = await insertRun();
    const [record] = await db.insert(records).values({ runId: run.id, sourceId: "src_a", itemKey: "a", data: {}, status: "valid" }).returning();
    await db.insert(evidence).values({
      recordId: record!.id,
      field: "title",
      value: "A",
      method: "DOM",
      sourceUrl: "https://example.com/cited",
      pageId: cited!.id,
      snippet: "A",
      locator: { kind: "css", value: "h1" },
      verified: true,
      confidence: 0.88,
    });

    const result = await pruneStorage({ olderThanDays: 30 });

    expect(result).toMatchObject({ pages: 1, pageBytes: 17 });
    const left = (await db.select({ id: pages.id }).from(pages)).map((p) => p.id).sort();
    expect(left).toEqual([cited!.id, recentUnused!.id].sort());
    expect(left).not.toContain(oldUnused!.id);
  });

  test("clears outputs copied onto cache hits, keeping the original answer", async () => {
    const call = { stage: "compile", model: "gpt-6-sol", schemaName: "s", inputHash: "h", ms: 1, output: { city: "Paris" } };
    await db.insert(llmCalls).values([call, { ...call, cached: true }]);

    expect((await pruneStorage({ olderThanDays: 30 })).llmOutputs).toBe(1);
    const original = await db.select({ output: llmCalls.output }).from(llmCalls).where(eq(llmCalls.cached, false));
    expect(original[0]!.output).toEqual({ city: "Paris" });
  });
});
