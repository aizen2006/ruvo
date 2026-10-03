import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { emptyMetrics, leadOf, type RecordDTO, type RecordStatus, type Signal } from "@repo/contracts";
import { db } from "../src/db/client";
import { attachWorkflow, saveContract, saveWorkflow } from "../src/db/repos/workflows";
import { records } from "../src/db/schema";
import { DEMO_CONTRACT } from "../src/plan/demoContract";
import type { RegistryCompany } from "../src/plan/registry";
import { buildTemplateIr } from "../src/plan/templates";
import { insertRun, resetDb } from "./helpers/db";
import { startTestServer } from "./helpers/http";

const api = startTestServer();
afterAll(api.close);
beforeEach(resetDb);

type NewRecord = typeof records.$inferInsert;
let item = 0;
/** A stored record; its key doubles as its canonical key and its only data. */
const record = (runId: string, status: RecordStatus, extra: Partial<NewRecord> = {}): NewRecord => {
  const key = extra.itemKey ?? `item-${++item}`;
  return { runId, sourceId: "src", itemKey: key, canonicalKey: key, data: { key }, status, ...extra };
};
const failed = (label: string): Signal => ({ criterionId: label, label, passed: false, strength: "hard", decidedBy: "RULES" });
const funnelOf = async (runId: string) => (await api.get(`/api/runs/${runId}`)).body.funnel;

describe("leadOf", () => {
  test("scores fit and certainty half each, out of 100", () => {
    expect(leadOf({ status: "valid", matchScore: 1, confidence: 0.99 })).toEqual({ score: 100, tier: "strong" });
    expect(leadOf({ status: "valid", matchScore: 0.5, confidence: 0.9 })).toEqual({ score: 70, tier: "good" });
    expect(leadOf({ status: "valid", matchScore: 0, confidence: 0.9 })).toEqual({ score: 45, tier: "possible" });
  });

  test("Strong starts at 80 and Good at 60", () => {
    expect(leadOf({ status: "valid", matchScore: 0.6, confidence: 1 })).toEqual({ score: 80, tier: "strong" });
    expect(leadOf({ status: "valid", matchScore: 0.6, confidence: 0.98 })).toEqual({ score: 79, tier: "good" });
    expect(leadOf({ status: "valid", matchScore: 0.2, confidence: 1 })).toEqual({ score: 60, tier: "good" });
    expect(leadOf({ status: "valid", matchScore: 0.2, confidence: 0.98 })).toEqual({ score: 59, tier: "possible" });
  });

  test("only valid records are leads", () => {
    expect(leadOf({ status: "incomplete", matchScore: 1, confidence: 1 })).toBeNull();
    expect(leadOf({ status: "invalid", matchScore: 1, confidence: 1 })).toBeNull();
  });
});

describe("records list", () => {
  test("lists the best leads first", async () => {
    const run = await insertRun();
    await db.insert(records).values([
      record(run.id, "incomplete", { itemKey: "incomplete", matchScore: 1, confidence: 1 }),
      record(run.id, "valid", { itemKey: "fits", matchScore: 0.625, confidence: 0.75 }),
      record(run.id, "valid", { itemKey: "weak", matchScore: 0, confidence: 0.875 }),
      record(run.id, "valid", { itemKey: "sure", matchScore: 0.5, confidence: 1 }),
      record(run.id, "valid", { itemKey: "best", matchScore: 1, confidence: 0.875 }),
    ]);
    const { items } = (await api.get(`/api/runs/${run.id}/records`)).body as { items: RecordDTO[] };
    // A surer row outranks a slightly better fit: "sure" scores 75, "fits" 69.
    expect(items.map((r) => r.data.key)).toEqual(["best", "sure", "fits", "weak", "incomplete"]);
    expect(items.map((r) => leadOf(r)?.score ?? null)).toEqual([94, 75, 69, 44, null]);
  });
});

describe("run funnel", () => {
  test("counts each step and says where most were lost", async () => {
    const run = await insertRun({ status: "running", metrics: { ...emptyMetrics(), rawRecords: 12 } });
    const company = { id: crypto.randomUUID(), name: "Acme", ats: "ashby", slug: "acme", tags: [], boardUrl: null, origin: "curated", jobCount: null, verifiedAt: null } satisfies RegistryCompany;
    const ir = buildTemplateIr(DEMO_CONTRACT, [company], {
      budgets: { maxPages: 10, maxBrowserPages: 0, maxLlmCalls: 0, maxDurationMs: 60_000, maxRecords: 10 },
      maxItemsPerSource: 10,
    });
    // A search that was skipped found nothing, so it doesn't count.
    ir.search = {
      queries: [
        { query: "acme jobs", hits: 4, cached: false, error: null },
        { query: "acme careers", hits: 2, cached: true, error: null },
        { query: "acme hiring", hits: 0, cached: false, error: "Search budget used up" },
      ],
      sources: [],
    };
    const contract = await saveContract({ requestId: run.requestId, contract: DEMO_CONTRACT, editedBy: "template" });
    await attachWorkflow(run.id, (await saveWorkflow({ contractId: contract.id, ir })).id);

    const [keeper] = await db.insert(records).values(record(run.id, "valid")).returning();
    await db.insert(records).values([
      ...Array.from({ length: 4 }, () => record(run.id, "invalid", { signals: [failed("Remote")] })),
      ...Array.from({ length: 2 }, () => record(run.id, "invalid", { signals: [failed("Senior")] })),
      ...Array.from({ length: 3 }, () => record(run.id, "incomplete", { rejectReasons: ["Missing required field: salary"] })),
      record(run.id, "valid"),
      record(run.id, "valid", { duplicateOf: keeper!.id }),
    ]);

    expect(await funnelOf(run.id)).toEqual({
      searched: 2,
      sources: ir.sources.length,
      collected: 12,
      qualified: 6,
      complete: 3,
      ready: 2,
      biggestLoss: { step: "qualified", count: 4, of: 12, reason: "Remote" },
    });
  });

  test("the biggest loss can be a missing value", async () => {
    const run = await insertRun({ status: "completed" });
    await db.insert(records).values([
      record(run.id, "invalid", { signals: [failed("Remote")] }),
      record(run.id, "incomplete", { rejectReasons: ["Missing required field: salary"] }),
      record(run.id, "incomplete", { rejectReasons: ["Missing required field: salary"] }),
      record(run.id, "incomplete", { rejectReasons: ["Missing required fields: location, salary"] }),
      record(run.id, "incomplete", { rejectReasons: ["Missing required field: location"] }),
      record(run.id, "valid"),
      record(run.id, "valid"),
    ]);
    // No raw records were counted (plans before every source had a prefilter step): what was stored was collected.
    expect(await funnelOf(run.id)).toEqual({
      searched: 0,
      sources: 0,
      collected: 7,
      qualified: 6,
      complete: 2,
      ready: 2,
      biggestLoss: { step: "complete", count: 3, of: 6, reason: "salary" },
    });
  });

  test("the biggest loss can be duplicates, and nothing lost is no loss", async () => {
    const run = await insertRun({ status: "completed" });
    const [keeper] = await db.insert(records).values(record(run.id, "valid")).returning();
    await db.insert(records).values([record(run.id, "valid"), ...Array.from({ length: 3 }, () => record(run.id, "valid", { duplicateOf: keeper!.id }))]);
    expect((await funnelOf(run.id)).biggestLoss).toEqual({ step: "ready", count: 3, of: 5, reason: null });

    const empty = await insertRun();
    expect(await funnelOf(empty.id)).toEqual({ searched: 0, sources: 0, collected: 0, qualified: 0, complete: 0, ready: 0, biggestLoss: null });
  });
});

describe("export", () => {
  test("carries each lead's tier and score, empty for rows that aren't leads", async () => {
    const run = await insertRun({ status: "completed" });
    await db.insert(records).values([
      record(run.id, "valid", { itemKey: "best", matchScore: 1, confidence: 0.875 }),
      record(run.id, "incomplete", { itemKey: "partial", matchScore: 1, confidence: 1 }),
    ]);

    const csv = (await (await api.raw(`/api/datasets/${run.id}/export?format=csv&scope=all`)).text()).trim().split("\r\n");
    expect(csv[0]).toStartWith("key,lead_tier,lead_score,status,");
    expect(csv[1]).toStartWith("best,Strong,94,valid,");
    expect(csv[2]).toStartWith("partial,,,incomplete,");

    const json = (await (await api.raw(`/api/datasets/${run.id}/export?format=json&scope=all`)).json()) as Array<Record<string, unknown>>;
    expect(json.map((r) => [r._lead_tier, r._lead_score])).toEqual([
      ["Strong", 94],
      [null, null],
    ]);
  });
});
