import type { Criterion, DatasetContract } from "@repo/contracts";
import type { NormalizeContext } from "../types";

const DEFAULT_COMPANY_CRITERION: Criterion = {
  id: "good_company",
  label: "AI / infra / devtools company",
  kind: "company_tag",
  fields: ["company"],
  values: ["ai_lab", "ai_infra", "devtools"],
  strength: "soft",
  weight: 0.3,
};

const DEFAULT_COMPANY_ASSUMPTION = {
  phrase: "good companies",
  interpretation: "Companies in RUVO's curated registry tagged as AI labs, AI infrastructure or developer tools",
  signals: ["registry tag: ai_lab / ai_infra / devtools"],
};

const mentionsCompanyQuality = (prompt: string) =>
  /\b(good|great|top|best|leading|reputable|strong|well[- ]known)\b[^.]{0,40}\b(compan(y|ies)|employers?|startups?|teams?)\b/i.test(prompt);

/**
 * The jobs domain's defaults after the compiler: "good companies" means the registry's AI and
 * developer-tool tags unless the model chose tags itself, and one posting is one link, or one
 * company's title in one place.
 */
export function normalizeJobs(contract: DatasetContract, { prompt, warnings }: NormalizeContext): DatasetContract {
  const next = { ...contract, dedupKeys: contract.dedupKeys.length ? contract.dedupKeys : [["url"], ["company", "title", "location"]] };
  if (!mentionsCompanyQuality(prompt) || contract.criteria.some((c) => c.kind === "company_tag")) return next;
  warnings.push('Added the default interpretation of "good companies" (registry tags)');
  return { ...next, criteria: [...next.criteria, DEFAULT_COMPANY_CRITERION], assumptions: [...next.assumptions, DEFAULT_COMPANY_ASSUMPTION] };
}
