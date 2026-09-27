import type { EvidenceMethod } from "@repo/contracts";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "../../db/client";
import { evidence, records } from "../../db/schema";
import type { RunContext } from "../../runs/runContext";
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
  let duplicates = 0;

  await db.transaction(async (tx) => {
    // Store keys (useful for inspection and for diffing runs) and reset earlier dedupe results.
    for (const { row, keys } of keyed) {
      const own = labelOf.get(row.sourceId) ?? row.sourceId;
      await tx
        .update(records)
        .set({ canonicalKey: keys[0] || null, fuzzyKey: keys[1] || null, duplicateOf: null, seenOn: [own] })
        .where(eq(records.id, row.id));
    }
    for (const [keeperId, duplicateIds] of clusters) {
      duplicates += duplicateIds.length;
      const seenOn = [...new Set([keeperId, ...duplicateIds].map((id) => labelOf.get(sourceOf.get(id)!) ?? sourceOf.get(id)!))];
      await tx.update(records).set({ seenOn }).where(eq(records.id, keeperId));
      await tx.update(records).set({ duplicateOf: keeperId }).where(inArray(records.id, duplicateIds));
    }
  });

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
