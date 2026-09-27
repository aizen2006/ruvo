import type { Budgets, CatalogKey, DatasetContract, PlanDraft, Provenance, SourceBranch, Step, WorkflowIR } from "@repo/contracts";
import { getAdapter } from "../adapters";
import { itemKeyFor } from "../execute/contractFields";
import type { SourceCandidate } from "./discovery";

/** Fields RUVO produces itself rather than reading from a source. */
const GENERATED_FIELDS: ReadonlySet<CatalogKey> = new Set(["match_reason"]);

const MAX_ITEMS_PER_SOURCE = 100;
/** Posts per free-text source that may use the LLM rung (the run's LLM budget still applies). */
const TEXT_SOURCE_LLM_ITEMS = 30;
const DEFAULT_ITEMS_PER_SOURCE = 40;

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

  const budgets: Budgets = {
    ...opts.caps,
    maxLlmCalls: clamp(draft.llmBudget, 0, opts.caps.maxLlmCalls),
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
