import type { Budgets, DatasetContract, PlanDraft, WorkflowIR } from "@repo/contracts";
import { registryCandidate, type SourceCandidate } from "./discovery";
import { compileIr, defaultSourcePlan } from "./irCompiler";
import type { RegistryCompany } from "./registry";

/** A plan that includes every candidate with default settings; no LLM involved. */
export function templateDraft(candidates: SourceCandidate[], maxItemsPerSource: number): PlanDraft {
  return {
    sources: candidates.map((c) => ({ ...defaultSourcePlan(c), maxItems: maxItemsPerSource })),
    fieldStrategies: [],
    llmBudget: 0,
    rationale: "Template plan: every discovered source with default settings",
  };
}

/**
 * Deterministic planning over registry companies. Used when the planner model is unavailable
 * and by tests; it goes through the same IR compiler as LLM plans.
 */
export function buildTemplateIr(
  contract: DatasetContract,
  companies: RegistryCompany[],
  opts: { budgets: Budgets; maxItemsPerSource: number; warnings?: string[] },
): WorkflowIR {
  const candidates = companies.map((c) => registryCandidate(c, `Curated registry company (${c.tags.join(", ") || "untagged"})`));
  const ir = compileIr(contract, templateDraft(candidates, opts.maxItemsPerSource), candidates, {
    caps: opts.budgets,
    provenance: { plannedBy: "template", model: null, reusedFrom: null, parentVersion: null },
  });
  return { ...ir, provenance: { ...ir.provenance, warnings: [...(opts.warnings ?? []), ...ir.provenance.warnings] } };
}
