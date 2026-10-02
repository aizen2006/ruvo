import { PlanDraft, type Budgets, type DatasetContract, type WorkflowIR } from "@repo/contracts";
import { getAdapter } from "../adapters";
import type { LlmClient } from "../llm/client";
import { logger } from "../libs/logger";
import type { Recalled } from "../memory/workflowMemory";
import type { SourceCandidate } from "./discovery";
import { compileIr } from "./irCompiler";
import { templateDraft } from "./templates";

const PLAN_SYSTEM_PROMPT = `You are RUVO's workflow planner. Given a Dataset Contract and the sources RUVO can collect from, decide how to collect the dataset.

For each candidate source, return an entry with:
- ref: the candidate's ref, exactly as given
- include: whether to collect from it (skip sources unlikely to have matching records)
- reason: one short sentence a user will read explaining the choice
- titleKeywords: extra title keywords that widen the role filter for this source (usually empty)
- fetchDetails: false (detail pages are not needed for API sources)
- maxItems: how many matching records to keep from this source (5-100), so the total roughly meets the contract's maxRecords with some headroom for rejects and duplicates

Candidates with origin "search" were found by searching the web: company job boards (adapters greenhouse, ashby, lever, workable, read through their APIs like registry companies), list pages (adapter html_list), pages about a single record (html_record, which yields one record) and public profiles known only from search results (search_hits). Their discoveryReason names the query that found them. Include the ones likely to hold records the contract asks for; skip off-topic ones.

fieldStrategies: for each contract field, the extraction methods to try in order, from: adapter, json_ld, embedded_json, dom_recipe, regex, llm, derived. Prefer adapter when the source provides the field.
llmBudget: LLM calls to allow for this run (0-60); API-only plans need few.
rationale: 2-3 sentences explaining the plan.`;

/** Asks the planner model to choose among discovered sources. */
export async function draftPlan(llm: LlmClient, contract: DatasetContract, candidates: SourceCandidate[], signal?: AbortSignal) {
  const sources = candidates.map((c) => ({
    ref: c.ref,
    label: c.label,
    adapter: c.adapter,
    origin: c.origin,
    kind: getAdapter(c.adapter).kind,
    tags: c.tags,
    postings: c.jobCount,
    providesFields: Object.keys(getAdapter(c.adapter).provides),
    discoveryReason: c.reason,
  }));
  const contractSummary = {
    title: contract.title,
    entity: contract.entity,
    entityDescription: contract.entityDescription,
    fields: contract.fields.map((f) => ({ name: f.name, catalogKey: f.catalogKey, required: f.required })),
    criteria: contract.criteria.map((c) => ({ label: c.label, kind: c.kind, strength: c.strength })),
    maxRecords: contract.maxRecords,
  };
  return llm.parse({
    stage: "plan",
    role: "planner",
    schema: PlanDraft,
    name: "plan_draft",
    system: PLAN_SYSTEM_PROMPT,
    user: JSON.stringify({ contract: contractSummary, candidates: sources }),
    signal,
  });
}

export interface PlanResult {
  ir: WorkflowIR;
  draft: PlanDraft;
  /** Set when a remembered plan was reused instead of calling the planner. */
  reused: Recalled | null;
}

/** Share of a remembered plan's chosen sources that must still be candidates for it to be reused. */
const REUSE_MIN_SOURCE_OVERLAP = 0.8;

/**
 * Plans a contract: a remembered plan when a similar request produced a good dataset,
 * otherwise an LLM draft, otherwise the template plan; the IR compiler runs in every case.
 * Planning never fails a run; the path taken is recorded in provenance.
 */
export async function planForContract(
  llm: LlmClient,
  contract: DatasetContract,
  candidates: SourceCandidate[],
  caps: Budgets,
  signal?: AbortSignal,
  remembered?: Recalled | null,
): Promise<PlanResult> {
  if (candidates.length === 0) {
    // Nothing to choose between (e.g. a non-job request with no linked page yet): skip the planner.
    const draft = templateDraft(candidates, 40);
    const ir = compileIr(contract, draft, candidates, {
      caps,
      provenance: { plannedBy: "template", model: null, reusedFrom: null, parentVersion: null },
    });
    ir.provenance.warnings.unshift("No sources to collect from yet");
    return { ir, draft, reused: null };
  }

  if (remembered && sourceOverlap(remembered.draft, candidates) >= REUSE_MIN_SOURCE_OVERLAP) {
    const ir = compileIr(contract, remembered.draft, candidates, {
      caps,
      provenance: { plannedBy: "memory", model: null, reusedFrom: remembered.runId, parentVersion: null },
    });
    ir.provenance.reuseScore = remembered.score;
    return { ir, draft: remembered.draft, reused: remembered };
  }

  try {
    const { data: draft, model } = await draftPlan(llm, contract, candidates, signal);
    const ir = compileIr(contract, draft, candidates, {
      caps,
      provenance: { plannedBy: "llm", model, reusedFrom: null, parentVersion: null },
    });
    return { ir, draft, reused: null };
  } catch (err) {
    if (signal?.aborted) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn("Planner failed; using template plan", { error: reason });
    const draft = templateDraft(candidates, 40);
    const ir = compileIr(contract, draft, candidates, {
      caps,
      provenance: { plannedBy: "template", model: null, reusedFrom: null, parentVersion: null },
    });
    ir.provenance.warnings.unshift(`Planner unavailable (${reason}); used the template plan`);
    return { ir, draft, reused: null };
  }
}

/** How many of the plan's included sources are still available (0..1). */
function sourceOverlap(draft: PlanDraft, candidates: SourceCandidate[]): number {
  const included = draft.sources.filter((s) => s.include);
  if (included.length === 0) return 0;
  const refs = new Set(candidates.map((c) => c.ref));
  return included.filter((s) => refs.has(s.ref)).length / included.length;
}
