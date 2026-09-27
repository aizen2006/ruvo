import { EVIDENCE_METHODS, type EvidenceMethod, type QualityReport } from "@repo/contracts";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { evidence, records, runs } from "../db/schema";
import type { RunContext } from "../runs/runContext";

type RecordRow = Pick<typeof records.$inferSelect, "id" | "sourceId" | "status" | "duplicateOf" | "confidence" | "rejectReasons" | "data">;
type EvidenceRow = { recordId: string; method: EvidenceMethod; verified: boolean };

const HISTOGRAM_EDGES = [0, 0.5, 0.75, 0.9, 1.0001];

/** Pure summary of a run's records and evidence; see buildQualityReport for the database side. */
export function summarizeQuality(input: {
  fields: string[];
  records: RecordRow[];
  evidence: EvidenceRow[];
  sourceLabels: Map<string, string>;
}): QualityReport {
  const unique = input.records.filter((r) => !r.duplicateOf);
  const kept = unique.filter((r) => r.status !== "invalid");
  const keptIds = new Set(kept.map((r) => r.id));
  const keptEvidence = input.evidence.filter((e) => keptIds.has(e.recordId));
  const count = (status: string) => unique.filter((r) => r.status === status).length;

  const methodMix = Object.fromEntries(EVIDENCE_METHODS.map((m) => [m, 0])) as Record<EvidenceMethod, number>;
  for (const e of keptEvidence) methodMix[e.method]++;

  const reasons = new Map<string, number>();
  for (const r of unique.filter((r) => r.status !== "valid")) {
    for (const reason of r.rejectReasons) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }

  const sources = [...new Set(input.records.map((r) => r.sourceId))];
  return {
    totals: {
      records: unique.length,
      valid: count("valid"),
      incomplete: count("incomplete"),
      invalid: count("invalid"),
      duplicates: input.records.length - unique.length,
    },
    completeness: input.fields.map((field) => {
      const filled = kept.filter((r) => r.data[field] !== null && r.data[field] !== undefined && r.data[field] !== "").length;
      return { field, filled, total: kept.length, rate: kept.length ? filled / kept.length : 0 };
    }),
    methodMix,
    verificationRate: keptEvidence.length ? keptEvidence.filter((e) => e.verified).length / keptEvidence.length : 0,
    confidenceHistogram: HISTOGRAM_EDGES.slice(0, -1).map((min, i) => {
      const max = HISTOGRAM_EDGES[i + 1]!;
      return { min, max: Math.min(max, 1), count: kept.filter((r) => r.confidence >= min && r.confidence < max).length };
    }),
    rejectReasons: [...reasons.entries()]
      .map(([reason, n]) => ({ reason, count: n }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    bySource: sources.map((sourceId) => {
      const own = input.records.filter((r) => r.sourceId === sourceId);
      return {
        sourceId,
        label: input.sourceLabels.get(sourceId) ?? sourceId,
        kept: own.filter((r) => !r.duplicateOf && r.status !== "invalid").length,
        valid: own.filter((r) => !r.duplicateOf && r.status === "valid").length,
        duplicates: own.filter((r) => r.duplicateOf).length,
      };
    }),
  };
}

/** Computes the run's quality report from the database and stores it on the run. */
export async function buildQualityReport(ctx: RunContext): Promise<QualityReport> {
  const rows = await db
    .select({
      id: records.id,
      sourceId: records.sourceId,
      status: records.status,
      duplicateOf: records.duplicateOf,
      confidence: records.confidence,
      rejectReasons: records.rejectReasons,
      data: records.data,
    })
    .from(records)
    .where(eq(records.runId, ctx.runId));
  const evidenceRows = rows.length
    ? await db
        .select({ recordId: evidence.recordId, method: evidence.method, verified: evidence.verified })
        .from(evidence)
        .where(inArray(evidence.recordId, rows.map((r) => r.id)))
    : [];

  const report = summarizeQuality({
    fields: ctx.contract.fields.map((f) => f.name),
    records: rows,
    evidence: evidenceRows,
    sourceLabels: new Map(ctx.ir.sources.map((s) => [s.id, s.label])),
  });
  await db.update(runs).set({ qualityReport: report }).where(eq(runs.id, ctx.runId));
  return report;
}
