import { z } from "zod";
import { EVIDENCE_METHODS } from "./record";

/** Data-quality summary computed at the end of a run (duplicates excluded). */
export const QualityReport = z.object({
  totals: z.object({
    records: z.number(),
    valid: z.number(),
    incomplete: z.number(),
    invalid: z.number(),
    duplicates: z.number(),
  }),
  /** Share of kept (non-rejected, non-duplicate) records that have each field. */
  completeness: z.array(z.object({ field: z.string(), filled: z.number(), total: z.number(), rate: z.number() })),
  /** Evidence rows of kept records by extraction method. */
  methodMix: z.record(z.enum(EVIDENCE_METHODS), z.number()),
  verificationRate: z.number(),
  confidenceHistogram: z.array(z.object({ min: z.number(), max: z.number(), count: z.number() })),
  rejectReasons: z.array(z.object({ reason: z.string(), count: z.number() })),
  bySource: z.array(z.object({ sourceId: z.string(), label: z.string(), kept: z.number(), valid: z.number(), duplicates: z.number() })),
});
export type QualityReport = z.infer<typeof QualityReport>;
