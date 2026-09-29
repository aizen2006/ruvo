import { z } from "zod";
import { Rung } from "./plan";
import { EvidenceMethod } from "./record";

/**
 * The compiled, executable workflow. Built by the server from a PlanDraft (never by the LLM
 * directly), versioned, and re-runnable. Each source is an independent branch of steps.
 */

export const AdapterId = z.enum(["greenhouse", "ashby", "lever", "workable", "hn_whoishiring", "html_list", "html_record", "search_hits"]);
export type AdapterId = z.infer<typeof AdapterId>;

export const FetchMode = z.enum(["auto", "http", "browser"]);
export type FetchMode = z.infer<typeof FetchMode>;

const base = { id: z.string() };

export const Step = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("collect"), adapter: AdapterId, params: z.unknown(), fetch: FetchMode, maxItems: z.number() }),
  z.object({ ...base, kind: z.literal("prefilter"), keywordsAny: z.array(z.string()), keywordsNone: z.array(z.string()), fields: z.array(z.string()) }),
  z.object({ ...base, kind: z.literal("triage"), task: z.enum(["RELEVANCE", "CRITERION"]), criterionId: z.string().nullable(), llmBudget: z.number() }),
  z.object({ ...base, kind: z.literal("extract_text"), parser: z.literal("hn_header"), llmFallback: z.boolean(), llmBudget: z.number() }),
  z.object({ ...base, kind: z.literal("enrich"), fields: z.array(z.string()), rungs: z.array(Rung), fetch: FetchMode, maxFetches: z.number() }),
  z.object({ ...base, kind: z.literal("match"), criteria: z.array(z.string()) }),
  z.object({ ...base, kind: z.literal("validate"), required: z.array(z.string()), requireEvidence: z.literal(true) }),
  z.object({ ...base, kind: z.literal("store") }),
]);
export type Step = z.infer<typeof Step>;
export type StepKind = Step["kind"];

export const SourceBranch = z.object({
  id: z.string(),
  ref: z.string(),
  label: z.string(),
  reason: z.string(),
  steps: z.array(Step),
});
export type SourceBranch = z.infer<typeof SourceBranch>;

export const Budgets = z.object({
  maxPages: z.number(),
  maxBrowserPages: z.number(),
  maxLlmCalls: z.number(),
  /** Web searches (Firecrawl). Optional so older budget literals stay valid; treated as 0 when absent. */
  maxSearches: z.number().optional(),
  maxDurationMs: z.number(),
  maxRecords: z.number(),
});
export type Budgets = z.infer<typeof Budgets>;

export const Provenance = z.object({
  plannedBy: z.enum(["llm", "template", "memory", "repair", "user_edit", "find_more"]),
  model: z.string().nullable(),
  /** Run whose plan was reused (plannedBy "memory"). */
  reusedFrom: z.string().nullable(),
  /** Similarity between this request and the reused one (0..1). */
  reuseScore: z.number().optional(),
  parentVersion: z.number().nullable(),
  warnings: z.array(z.string()),
  /** What self-repair changed, oldest first (set on versions planned by "repair"). */
  repairs: z.array(z.string()).optional(),
});
export type Provenance = z.infer<typeof Provenance>;

/** One web search run while looking for sources. */
export const SearchLog = z.object({
  query: z.string(),
  hits: z.number(),
  cached: z.boolean(),
  /** Set when the search failed or was skipped (e.g. the search budget ran out). */
  error: z.string().nullable(),
});
export type SearchLog = z.infer<typeof SearchLog>;

/** A source found by web search, kept so later edits re-plan it without searching again. */
export const FoundSource = z.object({
  ref: z.string(),
  adapter: AdapterId,
  label: z.string(),
  params: z.unknown(),
  reason: z.string(),
});
export type FoundSource = z.infer<typeof FoundSource>;

export const WorkflowIR = z.object({
  irVersion: z.literal(1),
  entity: z.string(),
  sources: z.array(SourceBranch),
  dedupe: z.object({ keys: z.array(z.array(z.string())), prefer: z.array(EvidenceMethod) }),
  budgets: Budgets,
  provenance: Provenance,
  /** What web search found while planning (absent when search was not used). */
  search: z.object({ queries: z.array(SearchLog), sources: z.array(FoundSource) }).optional(),
});
export type WorkflowIR = z.infer<typeof WorkflowIR>;
