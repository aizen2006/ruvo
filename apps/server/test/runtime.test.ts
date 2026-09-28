import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { runEvents } from "../src/db/schema";
import { createBudget } from "../src/runs/budget";
import { createEventBus, nextEventSeq, type EventRow } from "../src/runs/eventBus";
import { createMetrics } from "../src/runs/metrics";
import { insertRun, resetDb } from "./helpers/db";

const limits = { maxPages: 2, maxBrowserPages: 1, maxLlmCalls: 0, maxDurationMs: 1000, maxRecords: 10 };

describe("budget", () => {
  test("grants until exhausted, then refuses", () => {
    const budget = createBudget(limits);
    expect(budget.take("pages")).toBe(true);
    expect(budget.take("pages")).toBe(true);
    expect(budget.take("pages")).toBe(false);
    expect(budget.left("pages")).toBe(0);
    expect(budget.take("llmCalls")).toBe(false);
  });

  test("refuses a multi-unit take that would overdraw", () => {
    const budget = createBudget(limits);
    expect(budget.take("pages", 3)).toBe(false);
    expect(budget.left("pages")).toBe(2);
  });

  test("announces each exhausted budget once", () => {
    const announced: Array<[string, number]> = [];
    const budget = createBudget(limits, (key, limit) => announced.push([key, limit]));
    budget.take("pages", 2);
    budget.take("pages");
    budget.take("pages");
    budget.take("llmCalls");
    expect(announced).toEqual([
      ["pages", 2],
      ["llmCalls", 0],
    ]);
  });
});

describe("metrics", () => {
  test("counts and snapshots independently", () => {
    const metrics = createMetrics();
    metrics.inc("pagesVisited", 3);
    metrics.method("API", 2);
    metrics.decision("rules");
    metrics.addCost(0.25);
    const snap = metrics.snapshot();
    metrics.inc("pagesVisited");
    expect(snap.pagesVisited).toBe(3);
    expect(snap.fieldsByMethod.API).toBe(2);
    expect(snap.decisions.rules).toBe(1);
    expect(snap.llmCostUsd).toBe(0.25);
  });
});

describe("event bus", () => {
  beforeEach(resetDb);

  test("assigns sequential seq and writes batches in order", async () => {
    const written: EventRow[][] = [];
    const bus = createEventBus("run-1", { startSeq: 5, flushMs: 10_000, write: async (rows) => void written.push(rows) });
    bus.emit({ stage: "collecting", type: "a", message: "one" });
    bus.emit({ stage: "collecting", type: "b", message: "two" });
    await bus.flush();
    bus.emit({ stage: "validating", type: "c", message: "three" });
    await bus.close();
    expect(written.map((batch) => batch.map((e) => e.seq))).toEqual([[5, 6], [7]]);
  });

  test("a failed batch does not block later batches", async () => {
    let calls = 0;
    const written: number[] = [];
    const bus = createEventBus("run-1", {
      startSeq: 1,
      flushMs: 10_000,
      write: async (rows) => {
        if (calls++ === 0) throw new Error("db down");
        written.push(...rows.map((r) => r.seq));
      },
    });
    bus.emit({ stage: "collecting", type: "a", message: "lost" });
    await bus.flush();
    bus.emit({ stage: "collecting", type: "b", message: "kept" });
    await bus.close();
    expect(written).toEqual([2]);
  });

  test("persists to run_events and continues the sequence across attempts", async () => {
    const run = await insertRun();
    const first = createEventBus(run.id, { startSeq: await nextEventSeq(run.id) });
    first.emit({ stage: "collecting", type: "x", message: "attempt 1" });
    await first.close();

    const second = createEventBus(run.id, { startSeq: await nextEventSeq(run.id) });
    second.emit({ stage: "collecting", type: "x", message: "attempt 2" });
    await second.close();

    const rows = await db.select().from(runEvents).where(eq(runEvents.runId, run.id)).orderBy(runEvents.seq);
    expect(rows.map((r) => [r.seq, r.message])).toEqual([
      [1, "attempt 1"],
      [2, "attempt 2"],
    ]);
  });
});
