import type { Budgets, DatasetContract, SourceBranch, WorkflowIR } from "@repo/contracts";
import { itemKeyFor } from "../execute/contractFields";
import type { RegistryCompany } from "./registry";

/**
 * Deterministic planner: one branch per registry company running
 * collect → prefilter → match → validate → store. Used when no LLM plan exists
 * (and as the fallback when planning fails), so a run can always execute.
 */
export function buildTemplateIr(
  contract: DatasetContract,
  companies: RegistryCompany[],
  opts: { budgets: Budgets; maxItemsPerSource: number; warnings?: string[] },
): WorkflowIR {
  const hardKeywords = (kind: "keyword_any" | "keyword_none") =>
    contract.criteria.filter((c) => c.kind === kind && c.strength === "hard");
  const include = hardKeywords("keyword_any");
  const exclude = hardKeywords("keyword_none");
  const prefilterFields = [...new Set([...include, ...exclude].flatMap((c) => c.fields.map((f) => itemKeyFor(contract, f))))];

  const sources: SourceBranch[] = companies.map((company) => {
    const id = `src_${company.ats}_${company.slug}`.replace(/[^a-z0-9_]/gi, "_");
    return {
      id,
      ref: `${company.ats}:${company.slug}`,
      label: company.name,
      reason: `Curated registry company (${company.tags.join(", ") || "untagged"})`,
      steps: [
        {
          id: `${id}.collect`,
          kind: "collect",
          adapter: company.ats,
          params: { slug: company.slug, company: company.name, tags: company.tags },
          fetch: "http",
          maxItems: opts.maxItemsPerSource,
        },
        {
          id: `${id}.prefilter`,
          kind: "prefilter",
          keywordsAny: include.flatMap((c) => c.values),
          keywordsNone: exclude.flatMap((c) => c.values),
          fields: prefilterFields.length ? prefilterFields : ["title"],
        },
        { id: `${id}.match`, kind: "match", criteria: contract.criteria.map((c) => c.id) },
        {
          id: `${id}.validate`,
          kind: "validate",
          required: contract.fields.filter((f) => f.required).map((f) => f.name),
          requireEvidence: true,
        },
        { id: `${id}.store`, kind: "store" },
      ],
    };
  });

  return {
    irVersion: 1,
    entity: contract.entity,
    sources,
    dedupe: { keys: contract.dedupKeys, prefer: ["API", "JSON_LD", "EMBEDDED_JSON", "DOM", "REGEX", "LLM", "DERIVED"] },
    budgets: opts.budgets,
    provenance: { plannedBy: "template", model: null, reusedFrom: null, parentVersion: null, warnings: opts.warnings ?? [] },
  };
}
