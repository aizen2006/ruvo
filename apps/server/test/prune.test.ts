import { beforeEach, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { PRUNE_LOCK, pruneStorage } from "../src/db/prune";
import { evidence, llmCalls, pages, records, runEvents, searchCalls } from "../src/db/schema";
import { startWorker } from "../src/runs/worker";
import { insertRun, resetDb, waitFor } from "./helpers/db";

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

    expect((await pruneStorage({ olderThanDays: 30 }))!.llmOutputs).toBe(1);
    const original = await db.select({ output: llmCalls.output }).from(llmCalls).where(eq(llmCalls.cached, false));
    expect(original[0]!.output).toEqual({ city: "Paris" });
  });

  test("deletes finished runs' activity and AI and search logs older than the retention period", async () => {
    const old = new Date(Date.now() - 60 * DAY);
    const finished = await insertRun({ status: "completed", finishedAt: old });
    const waiting = await insertRun({ status: "awaiting_approval" });
    const recent = await insertRun({ status: "completed", finishedAt: new Date() });
    const event = (runId: string, ts: Date) => ({ runId, seq: 1, ts, stage: "done" as const, type: "run.completed", level: "info" as const, message: "Run completed" });
    await db.insert(runEvents).values([event(finished.id, old), event(waiting.id, old), event(recent.id, new Date())]);
    const call = { stage: "compile", model: "gpt-6-sol", schemaName: "s", inputHash: "h", ms: 1 };
    await db.insert(llmCalls).values([{ ...call, createdAt: old }, call]);
    const search = { provider: "searxng", query: "jobs", inputHash: "h" };
    await db.insert(searchCalls).values([{ ...search, createdAt: old }, search]);

    expect(await pruneStorage({ olderThanDays: 30 })).toMatchObject({ runEvents: 1, llmCalls: 1, searchCalls: 1 });
    // A run still waiting for approval keeps its activity, however old.
    const kept = await db.select({ runId: runEvents.runId }).from(runEvents);
    expect(kept.map((e) => e.runId).sort()).toEqual([waiting.id, recent.id].sort());
    expect(await db.select().from(llmCalls)).toHaveLength(1);
    expect(await db.select().from(searchCalls)).toHaveLength(1);
  });

  test("two prunes at once run once: the second does nothing while the first holds the lock", async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${PRUNE_LOCK})`);
      expect(await pruneStorage({ olderThanDays: 30 })).toBeNull();
    });
    expect(await pruneStorage({ olderThanDays: 30 })).not.toBeNull();
  });

  test("a worker prunes when it starts", async () => {
    await db.insert(llmCalls).values({ stage: "compile", model: "gpt-6-sol", schemaName: "s", inputHash: "h", ms: 1, createdAt: new Date(Date.now() - 60 * DAY) });
    const worker = startWorker({ execute: async () => {}, pollMs: 20 });
    await waitFor(() => db.select().from(llmCalls), (rows) => rows.length === 0);
    await worker.stop();
  });
});
