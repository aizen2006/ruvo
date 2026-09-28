import { DIFF_LIST_LIMIT, type DatasetContract, type RunDiff } from "@repo/contracts";
import { and, desc, eq, isNull, lt, ne } from "drizzle-orm";
import { db } from "../db/client";
import { records, runs } from "../db/schema";
import type { RunContext } from "../runs/runContext";

export interface DiffRecord {
  id: string;
  itemKey: string;
  canonicalKey: string | null;
  data: Record<string, unknown>;
}

/** Records are the same across runs when their canonical key (else their item key) matches. */
const keyOf = (r: DiffRecord) => r.canonicalKey ?? r.itemKey;
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Pure comparison of two runs' kept records over the contract's fields. */
export function diffRecords(previous: DiffRecord[], current: DiffRecord[], fields: string[], label: (r: DiffRecord) => string) {
  const before = new Map(previous.map((r) => [keyOf(r), r]));
  const after = new Map(current.map((r) => [keyOf(r), r]));
  const ref = (r: DiffRecord) => ({ key: keyOf(r), recordId: r.id, label: label(r) });

  const added = current.filter((r) => !before.has(keyOf(r))).map(ref);
  const removed = previous.filter((r) => !after.has(keyOf(r))).map(ref);
  const changed: RunDiff["changed"] = [];
  let unchanged = 0;
  for (const r of current) {
    const old = before.get(keyOf(r));
    if (!old) continue;
    const fieldChanges = fields.filter((f) => !same(old.data[f], r.data[f])).map((f) => ({ field: f, before: old.data[f] ?? null, after: r.data[f] ?? null }));
    if (fieldChanges.length) changed.push({ ...ref(r), fields: fieldChanges });
    else unchanged++;
  }

  return {
    counts: { added: added.length, removed: removed.length, changed: changed.length, unchanged },
    added: added.slice(0, DIFF_LIST_LIMIT),
    removed: removed.slice(0, DIFF_LIST_LIMIT),
    changed: changed.slice(0, DIFF_LIST_LIMIT),
  };
}

/** "Title, Company" for a record, using the contract's catalog fields. */
export function recordLabel(contract: DatasetContract) {
  const name = (key: string) => contract.fields.find((f) => f.catalogKey === key)?.name;
  const title = name("title");
  const company = name("company");
  return (r: DiffRecord) => [title && r.data[title], company && r.data[company]].filter(Boolean).join(", ") || keyOf(r);
}

/** Kept records of a run: unique and not rejected. */
async function keptRecords(runId: string): Promise<DiffRecord[]> {
  return db
    .select({ id: records.id, itemKey: records.itemKey, canonicalKey: records.canonicalKey, data: records.data })
    .from(records)
    .where(and(eq(records.runId, runId), isNull(records.duplicateOf), ne(records.status, "invalid")));
}

/**
 * Compares the run with the previous completed run of the same request and stores the diff
 * on the run. The first run of a request gets a diff with no previous run.
 */
export async function buildRunDiff(ctx: RunContext): Promise<RunDiff> {
  const [self] = await db.select({ requestId: runs.requestId, createdAt: runs.createdAt }).from(runs).where(eq(runs.id, ctx.runId));
  const [previous] = self
    ? await db
        .select({ id: runs.id, finishedAt: runs.finishedAt })
        .from(runs)
        .where(and(eq(runs.requestId, self.requestId), eq(runs.status, "completed"), lt(runs.createdAt, self.createdAt)))
        .orderBy(desc(runs.createdAt))
        .limit(1)
    : [];

  const current = await keptRecords(ctx.runId);
  const compared = diffRecords(previous ? await keptRecords(previous.id) : [], current, ctx.contract.fields.map((f) => f.name), recordLabel(ctx.contract));
  const diff: RunDiff = {
    previousRunId: previous?.id ?? null,
    previousFinishedAt: previous?.finishedAt?.toISOString() ?? null,
    // Without a previous run everything would be "added"; report the baseline instead.
    ...(previous ? compared : { counts: { added: 0, removed: 0, changed: 0, unchanged: current.length }, added: [], removed: [], changed: [] }),
  };
  await db.update(runs).set({ diff }).where(eq(runs.id, ctx.runId));
  return diff;
}
