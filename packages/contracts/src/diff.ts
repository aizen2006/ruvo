import { z } from "zod";

/**
 * What changed since the previous completed run of the same request (re-runs share a
 * request). Records are matched by their canonical key; only kept records count.
 */
const RecordRef = z.object({ key: z.string(), recordId: z.string(), label: z.string() });

export const RunDiff = z.object({
  previousRunId: z.string().nullable(),
  previousFinishedAt: z.string().nullable(),
  counts: z.object({ added: z.number(), removed: z.number(), changed: z.number(), unchanged: z.number() }),
  /** Lists are capped (see DIFF_LIST_LIMIT); counts are exact. */
  added: z.array(RecordRef),
  removed: z.array(RecordRef),
  changed: z.array(RecordRef.extend({ fields: z.array(z.object({ field: z.string(), before: z.unknown(), after: z.unknown() })) })),
});
export type RunDiff = z.infer<typeof RunDiff>;

export const DIFF_LIST_LIMIT = 50;
