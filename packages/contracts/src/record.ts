import { z } from "zod";

/** How a field value was obtained, ordered from most to least trustworthy. */
export const EVIDENCE_METHODS = ["API", "JSON_LD", "EMBEDDED_JSON", "DOM", "REGEX", "LLM", "SEARCH", "DERIVED"] as const;
export const EvidenceMethod = z.enum(EVIDENCE_METHODS);
export type EvidenceMethod = z.infer<typeof EvidenceMethod>;

/** How a page was fetched; "stealth" is the stealth browser used past a bot check. */
export const PAGE_VIAS = ["http", "browser", "stealth", "search"] as const;
export const PageVia = z.enum(PAGE_VIAS);
export type PageVia = z.infer<typeof PageVia>;

/** Where inside the source the value was found, so evidence can be re-checked later. */
export const Locator = z.object({
  kind: z.enum(["jsonPath", "css", "jsonLd", "regex", "textSpan", "derived"]),
  value: z.string(),
});
export type Locator = z.infer<typeof Locator>;

export const Evidence = z.object({
  field: z.string(),
  value: z.unknown(),
  method: EvidenceMethod,
  sourceUrl: z.string(),
  /** Stored page snapshot the snippet came from; null for derived values. */
  pageId: z.string().nullable(),
  /** How that page was fetched; absent when there is no page. */
  fetchedVia: PageVia.optional(),
  snippet: z.string(),
  locator: Locator,
  /** LLM output is only trusted when its quote is found verbatim in the page. */
  verified: z.boolean(),
  confidence: z.number().min(0).max(1),
  capturedAt: z.string(),
});
export type Evidence = z.infer<typeof Evidence>;

/** An explainable match signal shown as a chip, e.g. "✓ Remote". */
export const Signal = z.object({
  criterionId: z.string(),
  label: z.string(),
  passed: z.boolean().nullable(),
  strength: z.enum(["hard", "soft"]),
  decidedBy: z.enum(["RULES", "DECIDER", "LLM", "DEFAULT"]),
});
export type Signal = z.infer<typeof Signal>;

export const RecordStatus = z.enum(["valid", "invalid", "incomplete"]);
export type RecordStatus = z.infer<typeof RecordStatus>;

export const RecordDTO = z.object({
  id: z.string(),
  runId: z.string(),
  sourceId: z.string(),
  data: z.record(z.string(), z.unknown()),
  status: RecordStatus,
  duplicateOf: z.string().nullable(),
  matchScore: z.number(),
  confidence: z.number(),
  signals: z.array(Signal),
  rejectReasons: z.array(z.string()),
  seenOn: z.array(z.string()),
  createdAt: z.string(),
});
export type RecordDTO = z.infer<typeof RecordDTO>;
