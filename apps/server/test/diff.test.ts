import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { db } from "../src/db/client";
import { records, runs } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { buildRunDiff, diffRecords, recordLabel, type DiffRecord } from "../src/execute/diff";
import { DEMO_CONTRACT } from "../src/plan/demoContract";
import type { RunContext } from "../src/runs/runContext";
import { insertRun, resetDb } from "./helpers/db";
import { startTestServer } from "./helpers/http";

beforeEach(resetDb);

const rec = (key: string, data: Record<string, unknown>): DiffRecord => ({ id: crypto.randomUUID(), itemKey: `item-${key}`, canonicalKey: key, data });
const label = recordLabel(DEMO_CONTRACT);

describe("diffRecords", () => {
  test("finds added, removed, changed and unchanged records by canonical key", () => {
    const before = [rec("a", { title: "A", company: "X" }), rec("b", { title: "B", company: "X", location: "Berlin" }), rec("c", { title: "C" })];
    const after = [rec("a", { title: "A", company: "X" }), rec("b", { title: "B", company: "X", location: "Remote" }), rec("d", { title: "D", company: "Y" })];
    const diff = diffRecords(before, after, ["title", "company", "location"], label);

    expect(diff.counts).toEqual({ added: 1, removed: 1, changed: 1, unchanged: 1 });
    expect(diff.added[0]).toMatchObject({ key: "d", label: "D, Y" });
    expect(diff.removed[0]).toMatchObject({ key: "c", label: "C" });
    expect(diff.changed[0]!.fields).toEqual([{ field: "location", before: "Berlin", after: "Remote" }]);
  });

  test("falls back to the item key when there is no canonical key", () => {
    const a = { ...rec("x", { title: "A" }), canonicalKey: null };
    expect(diffRecords([a], [{ ...a, id: "other" }], ["title"], label).counts.unchanged).toBe(1);
  });
});

describe("buildRunDiff", () => {
  const api = startTestServer();
  afterAll(() => api.close());

  const ctxFor = (runId: string) => ({ runId, contract: DEMO_CONTRACT }) as RunContext;
  const addRecords = (runId: string, rows: Array<[string, Record<string, unknown>, ("valid" | "invalid")?]>) =>
    db.insert(records).values(rows.map(([key, data, status]) => ({ runId, sourceId: "s", itemKey: key, canonicalKey: key, data, status: status ?? "valid" })));

  test("compares with the previous completed run of the same request", async () => {
    const first = await insertRun({ status: "completed", finishedAt: new Date() });
    await addRecords(first.id, [["a", { title: "A" }], ["b", { title: "B" }]]);
    const second = await insertRun({ requestId: first.requestId, status: "running" });
    await addRecords(second.id, [["a", { title: "A2" }], ["c", { title: "C" }], ["r", { title: "Rejected" }, "invalid"]]);

    expect((await api.get(`/api/runs/${second.id}/diff`)).status).toBe(404);
    const diff = await buildRunDiff(ctxFor(second.id));
    expect(diff).toMatchObject({ previousRunId: first.id, counts: { added: 1, removed: 1, changed: 1, unchanged: 0 } });

    const { status, body } = await api.get(`/api/runs/${second.id}/diff`);
    expect(status).toBe(200);
    expect(body.changed[0].fields).toEqual([{ field: "title", before: "A", after: "A2" }]);
  });

  test("the first run of a request is a baseline", async () => {
    const run = await insertRun({ status: "running" });
    await addRecords(run.id, [["a", { title: "A" }]]);
    expect(await buildRunDiff(ctxFor(run.id))).toMatchObject({ previousRunId: null, counts: { added: 0, unchanged: 1 } });
    const [row] = await db.select({ diff: runs.diff }).from(runs).where(eq(runs.id, run.id));
    expect(row!.diff?.previousRunId).toBeNull();
  });
});
