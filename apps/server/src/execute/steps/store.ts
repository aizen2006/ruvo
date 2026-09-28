import { inArray, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { evidence, records } from "../../db/schema";
import { fieldConfidence } from "../../extract/confidence";
import type { Metrics } from "../../runs/metrics";
import type { Candidate } from "../candidate";
import { itemKeyFor } from "../contractFields";
import type { StepFn } from "./types";

/**
 * Persists candidates as records with one evidence row per field. Upserts on
 * (run, item key) and replaces evidence, so a re-attempted run converges to the same rows.
 */
export const store: StepFn<"store"> = async (ctx, _branch, _step, candidates) => {
  // A page can list the same item twice (e.g. a "featured" block); one upsert may not touch a row twice.
  const input = [...new Map(candidates.map((c) => [c.key, c])).values()];
  if (input.length === 0) return input;
  const fields = ctx.contract.fields;

  const rows = input.map((c) => ({
    runId: ctx.runId,
    sourceId: c.sourceId,
    itemKey: c.key,
    data: Object.fromEntries(fields.map((f) => [f.name, c.item.fields[itemKeyFor(ctx.contract, f.name)]?.value ?? null])),
    status: c.status ?? "incomplete",
    matchScore: c.matchScore,
    confidence: c.confidence,
    signals: c.signals,
    rejectReasons: c.rejectReasons,
  }));

  await db.transaction(async (tx) => {
    const saved = await tx
      .insert(records)
      .values(rows)
      .onConflictDoUpdate({
        target: [records.runId, records.itemKey],
        set: {
          data: sql`excluded.data`,
          status: sql`excluded.status`,
          matchScore: sql`excluded.match_score`,
          confidence: sql`excluded.confidence`,
          signals: sql`excluded.signals`,
          rejectReasons: sql`excluded.reject_reasons`,
        },
      })
      .returning({ id: records.id, itemKey: records.itemKey });

    const idByKey = new Map(saved.map((r) => [r.itemKey, r.id]));
    await tx.delete(evidence).where(inArray(evidence.recordId, saved.map((r) => r.id)));

    const evidenceRows = input.flatMap((c) =>
      fields.flatMap((f) => {
        const field = c.item.fields[itemKeyFor(ctx.contract, f.name)];
        if (!field) return [];
        const e = field.evidence;
        return [
          {
            recordId: idByKey.get(c.key)!,
            field: f.name,
            value: field.value,
            method: e.method,
            sourceUrl: e.sourceUrl,
            pageId: e.pageId,
            snippet: e.snippet,
            locator: e.locator,
            verified: e.verified,
            confidence: fieldConfidence(e.method, e.verified),
          },
        ];
      }),
    );
    if (evidenceRows.length) await tx.insert(evidence).values(evidenceRows);
    for (const row of evidenceRows) ctx.metrics.method(row.method);
  });

  countStatuses(ctx.metrics, input);
  return input;
};

function countStatuses(metrics: Metrics, input: Candidate[]) {
  for (const c of input) {
    if (c.status === "valid") metrics.inc("validRecords");
    else if (c.status === "invalid") metrics.inc("invalidRecords");
    else metrics.inc("incompleteRecords");
  }
}
