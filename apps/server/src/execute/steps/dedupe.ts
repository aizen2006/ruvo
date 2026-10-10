import type { EvidenceMethod } from "@repo/contracts";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { RunContext } from "../../core/run";
import { db } from "../../db/client";
import { evidence, records } from "../../db/schema";
import { clusterDuplicates, methodRank, recordKeys } from "../dedupe";

/**
 * Global deduplication after every source branch has stored its records.
 * Rejected (invalid) records are left out. Duplicates point at their keeper via
 * duplicate_of; keepers list every source they were seen on. Returns the duplicate count.
 */
export async function dedupeRun(ctx: RunContext): Promise<number> {
  const rows = await db
    .select()
    .from(records)
    .where(and(eq(records.runId, ctx.runId), ne(records.status, "invalid")));
  if (rows.length === 0) return 0;

  const methods = await db
    .select({ recordId: evidence.recordId, method: evidence.method })
    .from(evidence)
    .where(inArray(evidence.recordId, rows.map((r) => r.id)));
  const methodsByRecord = new Map<string, EvidenceMethod[]>();
  for (const m of methods) methodsByRecord.set(m.recordId, [...(methodsByRecord.get(m.recordId) ?? []), m.method]);

  const keyed = rows.map((r) => ({ row: r, keys: recordKeys(ctx.contract, r.data, ctx.ir.dedupe.keys) }));
  const clusters = clusterDuplicates(
    keyed.map(({ row, keys }) => ({
      id: row.id,
      keys,
      methodRank: methodRank(methodsByRecord.get(row.id) ?? []),
      confidence: row.confidence,
      completeness: Object.values(row.data).filter((v) => v !== null && v !== "").length,
      createdAt: row.createdAt.getTime(),
    })),
  );

  const labelOf = new Map(ctx.ir.sources.map((s) => [s.id, s.label]));
  const sourceOf = new Map(rows.map((r) => [r.id, r.sourceId]));
  const seenOn = (ids: string[]) => [...new Set(ids.map((id) => labelOf.get(sourceOf.get(id)!) ?? sourceOf.get(id)!))];

  // Every record's keys (useful for inspection and for diffing runs) and result, replacing earlier dedupe results.
  const results = new Map(
    keyed.map(({ row, keys }) => [row.id, { canonicalKey: keys[0] || null, fuzzyKey: keys[1] || null, duplicateOf: null as string | null, seenOn: seenOn([row.id]) }]),
  );
  let duplicates = 0;
  for (const [keeperId, duplicateIds] of clusters) {
    duplicates += duplicateIds.length;
    results.get(keeperId)!.seenOn = seenOn([keeperId, ...duplicateIds]);
    for (const id of duplicateIds) results.get(id)!.duplicateOf = keeperId;
  }

  // One statement for the whole run rather than one per record.
  const values = [...results].map(([id, r]) => sql`(${id}::uuid, ${r.canonicalKey}, ${r.fuzzyKey}, ${r.duplicateOf}::uuid, ${JSON.stringify(r.seenOn)}::jsonb)`);
  await db.execute(sql`
    update ${records} set canonical_key = v.canonical_key, fuzzy_key = v.fuzzy_key, duplicate_of = v.duplicate_of, seen_on = v.seen_on
    from (values ${sql.join(values, sql`, `)}) as v(id, canonical_key, fuzzy_key, duplicate_of, seen_on)
    where ${records.id} = v.id`);

  ctx.metrics.set("duplicates", duplicates);
  await recountStatuses(ctx);
  return duplicates;
}

/** Status counters from the database, excluding duplicates, so metrics match the dataset. */
async function recountStatuses(ctx: RunContext) {
  const rows = await db
    .select({ status: records.status })
    .from(records)
    .where(and(eq(records.runId, ctx.runId), isNull(records.duplicateOf)));
  const count = (status: string) => rows.filter((r) => r.status === status).length;
  ctx.metrics.set("validRecords", count("valid"));
  ctx.metrics.set("incompleteRecords", count("incomplete"));
  ctx.metrics.set("invalidRecords", count("invalid"));
}
