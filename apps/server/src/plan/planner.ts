import { PlanDraft, type Budgets, type DatasetContract, type WorkflowIR } from "@repo/contracts";
import { getAdapter } from "../adapters";
import type { LlmClient } from "../llm/client";
import { logger } from "../libs/logger";
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

fieldStrategies: for each contract field, the extraction methods to try in order, from: adapter, json_ld, embedded_json, dom_recipe, regex, llm, derived. Prefer adapter when the source provides the field.
llmBudget: LLM calls to allow for this run (0-60); API-only plans need few.
rationale: 2-3 sentences explaining the plan.`;

/** Asks the planner model to choose among discovered sources. */
export async function draftPlan(llm: LlmClient, contract: DatasetContract, candidates: SourceCandidate[], signal?: AbortSignal) {
  const sources = candidates.map((c) => ({
    ref: c.ref,
    label: c.label,
    kind: getAdapter(c.adapter).kind,
    tags: c.tags,
    postings: c.jobCount,
    providesFields: Object.keys(getAdapter(c.adapter).provides),
    discoveryReason: c.reason,
  }));
  const contractSummary = {
    title: contract.title,
    entity: contract.entity,
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
}

/**
 * Plans a contract: an LLM draft when possible, otherwise the template plan, then the
 * IR compiler in both cases. Planning never fails a run; the fallback is noted in provenance.
 */
export async function planForContract(
  llm: LlmClient,
  contract: DatasetContract,
  candidates: SourceCandidate[],
  caps: Budgets,
  signal?: AbortSignal,
): Promise<PlanResult> {
  try {
    const { data: draft, model } = await draftPlan(llm, contract, candidates, signal);
    const ir = compileIr(contract, draft, candidates, {
      caps,
      provenance: { plannedBy: "llm", model, reusedFrom: null, parentVersion: null },
    });
    return { ir, draft };
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
    return { ir, draft };
  }
}
