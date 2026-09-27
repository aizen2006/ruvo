import { z } from "zod";
import { EVIDENCE_METHODS } from "./record";

/**
 * Run lifecycle. `queued` covers compile/plan; `queued_run` means approved and waiting for a worker.
 */
export const RunStatus = z.enum([
  "queued",
  "compiling",
  "planning",
  "awaiting_approval",
  "queued_run",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type RunStatus = z.infer<typeof RunStatus>;

export const TERMINAL_STATUSES: readonly RunStatus[] = ["completed", "failed", "cancelled"];
export const isTerminal = (s: RunStatus) => TERMINAL_STATUSES.includes(s);

/** User-facing pipeline stages, in display order. */
export const STAGES = [
  "understanding",
  "planning",
  "discovering",
  "collecting",
  "extracting",
  "validating",
  "deduplicating",
  "done",
] as const;
export const Stage = z.enum(STAGES);
export type Stage = z.infer<typeof Stage>;

const count = z.number().int().nonnegative();

export const RunMetrics = z.object({
  pagesVisited: count,
  httpRequests: count,
  browserPages: count,
  cacheHits: count,
  rawRecords: count,
  validRecords: count,
  invalidRecords: count,
  incompleteRecords: count,
  duplicates: count,
  llmCalls: count,
  llmCostUsd: z.number().nonnegative(),
  decisions: z.object({ rules: count, decider: count, llm: count }),
  fieldsByMethod: z.record(z.enum(EVIDENCE_METHODS), count),
});
export type RunMetrics = z.infer<typeof RunMetrics>;

export const emptyMetrics = (): RunMetrics => ({
  pagesVisited: 0,
  httpRequests: 0,
  browserPages: 0,
  cacheHits: 0,
  rawRecords: 0,
  validRecords: 0,
  invalidRecords: 0,
  incompleteRecords: 0,
  duplicates: 0,
  llmCalls: 0,
  llmCostUsd: 0,
  decisions: { rules: 0, decider: 0, llm: 0 },
  fieldsByMethod: { API: 0, JSON_LD: 0, EMBEDDED_JSON: 0, DOM: 0, REGEX: 0, LLM: 0, DERIVED: 0 },
});

export const RunEvent = z.object({
  seq: z.number().int(),
  ts: z.string(),
  stage: Stage,
  type: z.string().describe("Dotted event name, e.g. step.completed, fetch.escalated"),
  level: z.enum(["info", "warn", "error"]),
  sourceId: z.string().nullable(),
  message: z.string(),
  data: z.unknown(),
});
export type RunEvent = z.infer<typeof RunEvent>;
