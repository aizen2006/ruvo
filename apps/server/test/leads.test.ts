import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { leadOf, type RecordDTO, type RecordStatus } from "@repo/contracts";
import { db } from "../src/db/client";
import { records } from "../src/db/schema";
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
