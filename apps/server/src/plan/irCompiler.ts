import type { Budgets, CatalogKey, DatasetContract, PlanDraft, Provenance, SourceBranch, Step, WorkflowIR } from "@repo/contracts";
import { getAdapter } from "../adapters";
import { itemKeyFor } from "../execute/contractFields";
import type { SourceCandidate } from "./discovery";

/** Fields RUVO produces itself rather than reading from a source. */
const GENERATED_FIELDS: ReadonlySet<CatalogKey> = new Set(["match_reason"]);

const MAX_ITEMS_PER_SOURCE = 100;
/** Posting pages each source may fetch to fill missing fields (JSON-LD, page text). */
const ENRICH_PAGE_FETCHES = 15;
/** Posts per free-text source that may use the LLM rung (the run's LLM budget still applies). */
const TEXT_SOURCE_LLM_ITEMS = 30;
const DEFAULT_ITEMS_PER_SOURCE = 40;
/** LLM calls a list page may need to discover (or rediscover) its recipe: one proposal plus one retry. */
const RECIPE_DISCOVERY_CALLS = 2;
/** Records the LLM judge decides per call. */
const JUDGE_BATCH = 20;

export interface CompileOptions {
  /** Hard caps from the environment; planned budgets are clamped to these. */
  caps: Budgets;
  provenance: Omit<Provenance, "warnings">;
}

/**
 * Turns a PlanDraft (what the planner chose) into an executable WorkflowIR (how to run it).
 * It never trusts the draft: unknown sources are dropped, budgets are clamped, and required
 * fields no source can produce are relaxed. Each repair is recorded in provenance.warnings.
 */
export function compileIr(contract: DatasetContract, draft: PlanDraft, candidates: SourceCandidate[], opts: CompileOptions): WorkflowIR {
  const warnings: string[] = [];
  const byRef = new Map(candidates.map((c) => [c.ref, c]));

  const chosen: Array<{ candidate: SourceCandidate; plan: PlanDraft["sources"][number] }> = [];
  for (const plan of draft.sources.filter((s) => s.include)) {
    const candidate = byRef.get(plan.ref);
    if (!candidate) warnings.push(`Ignored unknown source "${plan.ref}"`);
    else if (chosen.some((c) => c.candidate.ref === plan.ref)) warnings.push(`Ignored duplicate source "${plan.ref}"`);
    else chosen.push({ candidate, plan });
  }
  if (chosen.length === 0 && candidates.length > 0) {
    warnings.push("The plan selected no usable sources; using every discovered source");
    for (const candidate of candidates) chosen.push({ candidate, plan: defaultSourcePlan(candidate) });
  }

  const required = effectiveRequiredFields(contract, chosen.map((c) => c.candidate), warnings);
  const sources = chosen.map(({ candidate, plan }) => buildBranch(contract, candidate, plan, required));

  // The planner estimates LLM use; never plan below what the compiled steps need to work.
  const floor = llmFloor(contract, sources);
  if (draft.llmBudget < floor) {
    warnings.push(`Raised the LLM budget from ${draft.llmBudget} to ${floor} calls to cover page recipes and judged criteria`);
  }
  const budgets: Budgets = {
    ...opts.caps,
    maxLlmCalls: clamp(Math.max(draft.llmBudget, floor), 0, opts.caps.maxLlmCalls),
    maxRecords: clamp(contract.maxRecords, 1, opts.caps.maxRecords),
  };

  return {
    irVersion: 1,
    entity: contract.entity,
    sources,
    dedupe: { keys: contract.dedupKeys, prefer: ["API", "JSON_LD", "EMBEDDED_JSON", "DOM", "REGEX", "LLM", "DERIVED"] },
    budgets,
    provenance: { ...opts.provenance, warnings },
  };
}

/**
 * The fewest LLM calls the compiled steps need to work: recipe discovery for list pages,
 * the judge for semantic criteria the decision layer cannot settle, and LLM enrichment.
 * Free-text steps have their own caps and degrade to parsers, so they add nothing here.
 */
function llmFloor(contract: DatasetContract, sources: SourceBranch[]): number {
  const semantic = contract.criteria.some((c) => c.kind === "semantic");
  let calls = 0;
  for (const branch of sources) {
    for (const step of branch.steps) {
      if (step.kind === "collect" && step.adapter === "html_list") calls += RECIPE_DISCOVERY_CALLS;
      if (step.kind === "collect" && semantic) calls += Math.ceil(step.maxItems / JUDGE_BATCH);
      if (step.kind === "enrich" && step.rungs.includes("llm")) calls += 2;
    }
  }
  return calls;
}

/** A plan that simply includes a candidate with defaults (template planning and fallbacks). */
export function defaultSourcePlan(candidate: SourceCandidate): PlanDraft["sources"][number] {
  return { ref: candidate.ref, include: true, reason: candidate.reason, titleKeywords: [], fetchDetails: false, maxItems: DEFAULT_ITEMS_PER_SOURCE };
}

function buildBranch(
  contract: DatasetContract,
  candidate: SourceCandidate,
  plan: PlanDraft["sources"][number],
  required: string[],
): SourceBranch {
  const id = `src_${candidate.ref}`.replace(/[^a-z0-9_]/gi, "_").toLowerCase();
  const hard = (kind: "keyword_any" | "keyword_none") => contract.criteria.filter((c) => c.kind === kind && c.strength === "hard");
  const include = hard("keyword_any");
  const exclude = hard("keyword_none");
  const prefilterFields = [...new Set([...include, ...exclude].flatMap((c) => c.fields.map((f) => itemKeyFor(contract, f))))];
  const adapterKind = getAdapter(candidate.adapter).kind;

  const steps: Step[] = [
    {
      id: `${id}.collect`,
      kind: "collect",
      adapter: candidate.adapter,
      params: candidate.params,
      fetch: adapterKind === "api" ? "http" : "auto",
      maxItems: clamp(Math.round(plan.maxItems || DEFAULT_ITEMS_PER_SOURCE), 1, MAX_ITEMS_PER_SOURCE),
    },
  ];
  // Free-text sources need their fields read from the text before any keyword gate can apply.
  // Triage decides relevance first so LLM extraction is spent only on promising posts.
  if (adapterKind === "text") {
    steps.push(
      { id: `${id}.triage`, kind: "triage", task: "RELEVANCE", criterionId: null, llmBudget: TEXT_SOURCE_LLM_ITEMS },
      { id: `${id}.extract_text`, kind: "extract_text", parser: "hn_header", llmFallback: true, llmBudget: TEXT_SOURCE_LLM_ITEMS },
    );
  }
  // The keyword gate only makes sense when the contract has keyword criteria to apply.
  if (include.length || exclude.length) {
    steps.push({
      id: `${id}.prefilter`,
      kind: "prefilter",
      keywordsAny: include.length ? [...include.flatMap((c) => c.values), ...plan.titleKeywords] : [],
      keywordsNone: exclude.flatMap((c) => c.values),
      fields: prefilterFields.length ? prefilterFields : ["title"],
    });
  }
  // Fields this source doesn't provide are looked for in descriptions and posting pages.
  const provided = new Set(Object.keys(getAdapter(candidate.adapter).provides));
  const toEnrich = contract.fields.filter((f) => f.catalogKey !== "custom" && !GENERATED_FIELDS.has(f.catalogKey) && !provided.has(f.catalogKey));
  if (toEnrich.length && adapterKind !== "text") {
    steps.push({
      id: `${id}.enrich`,
      kind: "enrich",
      fields: toEnrich.map((f) => f.name),
      rungs: ["regex", "json_ld", ...(toEnrich.some((f) => f.required) ? (["llm"] as const) : [])],
      fetch: "http",
      maxFetches: ENRICH_PAGE_FETCHES,
    });
  }
  steps.push(
    { id: `${id}.match`, kind: "match", criteria: contract.criteria.map((c) => c.id) },
    { id: `${id}.validate`, kind: "validate", required, requireEvidence: true },
    { id: `${id}.store`, kind: "store" },
  );

  return { id, ref: candidate.ref, label: candidate.label, reason: plan.reason || candidate.reason, steps };
}

/**
 * Required fields that at least one chosen source can produce. A required field nobody can
 * produce would mark every record incomplete, so it is relaxed with a warning instead.
 */
function effectiveRequiredFields(contract: DatasetContract, chosen: SourceCandidate[], warnings: string[]): string[] {
  const provided = new Set(chosen.flatMap((c) => Object.keys(getAdapter(c.adapter).provides)));
  return contract.fields
    .filter((f) => f.required)
    .filter((f) => {
      const producible = GENERATED_FIELDS.has(f.catalogKey) || provided.has(f.catalogKey);
      if (!producible) warnings.push(`"${f.name}" is required but no chosen source provides it; treating it as optional`);
      return producible;
    })
    .map((f) => f.name);
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
