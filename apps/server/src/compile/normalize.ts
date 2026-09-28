import type { Criterion, DatasetContract, FieldSpec } from "@repo/contracts";

/**
 * Deterministic clean-up of a compiled contract, so later stages can rely on its shape
 * regardless of small LLM mistakes. Every repair is reported as a warning.
 * Also used when a user edits a contract before approving a run.
 */
export function normalizeContract(input: DatasetContract, prompt: string): { contract: DatasetContract; warnings: string[] } {
  const warnings: string[] = [];
  const fields = normalizeFields(input, warnings);
  const fieldNames = new Set(fields.map((f) => f.name));
  const nameFor = (catalogKey: string) => fields.find((f) => f.catalogKey === catalogKey)?.name;

  const criteria = uniqueIds(input.criteria)
    .map((c) => repairCriterion(c, fieldNames, nameFor, warnings))
    .filter((c): c is Criterion => c !== null);

  const assumptions = [...input.assumptions];
  if (input.entity === "job_posting" && mentionsCompanyQuality(prompt) && !criteria.some((c) => c.kind === "company_tag")) {
    criteria.push(DEFAULT_COMPANY_CRITERION);
    assumptions.push(DEFAULT_COMPANY_ASSUMPTION);
    warnings.push('Added the default interpretation of "good companies" (registry tags)');
  }

  const dedupKeys = input.dedupKeys
    .map((key) => key.filter((f) => fieldNames.has(f)))
    .filter((key) => key.length > 0);

  const urls = normalizeUrls(input.sourceHints.urls, warnings);

  return {
    contract: {
      ...input,
      sourceHints: { ...input.sourceHints, urls },
      fields,
      criteria,
      assumptions,
      dedupKeys: dedupKeys.length ? dedupKeys : defaultDedupKeys(fieldNames),
      maxRecords: clamp(Math.round(input.maxRecords || 200), 1, 1000),
    },
    warnings,
  };
}

/** Linked pages: absolute http(s) URLs only, each once ("example.com/jobs" gets https://). */
function normalizeUrls(urls: string[], warnings: string[]): string[] {
  const kept = new Set<string>();
  for (const raw of urls) {
    const trimmed = raw.trim();
    try {
      const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported protocol");
      kept.add(url.href);
    } catch {
      warnings.push(`Ignored "${trimmed}": not a web page address`);
    }
  }
  return [...kept];
}

const REQUIRED_JOB_FIELDS: FieldSpec[] = [
  { name: "company", catalogKey: "company", type: "string", required: true, description: "Hiring company" },
  { name: "title", catalogKey: "title", type: "string", required: true, description: "Job title" },
  { name: "url", catalogKey: "url", type: "url", required: true, description: "Link to the posting" },
];

function normalizeFields(input: DatasetContract, warnings: string[]): FieldSpec[] {
  const seen = new Set<string>();
  const fields: FieldSpec[] = [];
  for (const field of input.fields) {
    let name = snakeCase(field.name) || snakeCase(field.catalogKey) || "field";
    while (seen.has(name)) name = `${name}_2`;
    if (name !== field.name) warnings.push(`Renamed field "${field.name}" to "${name}"`);
    seen.add(name);
    fields.push({ ...field, name });
  }

  if (input.entity === "job_posting") {
    for (const required of REQUIRED_JOB_FIELDS) {
      if (!fields.some((f) => f.catalogKey === required.catalogKey)) {
        fields.push(required);
        warnings.push(`Added missing "${required.name}" field`);
      }
    }
  }
  return fields;
}

function repairCriterion(
  criterion: Criterion,
  fieldNames: Set<string>,
  nameFor: (catalogKey: string) => string | undefined,
  warnings: string[],
): Criterion | null {
  // The model sometimes names catalog keys instead of field names; map them back.
  let fields = criterion.fields.map((f) => (fieldNames.has(f) ? f : (nameFor(f) ?? f))).filter((f) => fieldNames.has(f));
  if (fields.length === 0) {
    const fallback = criterion.kind === "company_tag" ? nameFor("company") : criterion.kind === "equals" ? undefined : nameFor("title");
    if (!fallback) {
      warnings.push(`Dropped criterion "${criterion.label}": it refers to no known field`);
      return null;
    }
    fields = [fallback];
  }

  const values = criterion.values.map((v) => v.trim()).filter(Boolean);
  if (values.length === 0) {
    warnings.push(`Dropped criterion "${criterion.label}": it has no values`);
    return null;
  }
  if (criterion.kind === "regex" && !isValidRegex(values[0]!)) {
    warnings.push(`Dropped criterion "${criterion.label}": invalid regular expression`);
    return null;
  }
  return { ...criterion, fields, values, weight: criterion.strength === "hard" ? 1 : clamp(criterion.weight, 0, 1) };
}

function uniqueIds(criteria: Criterion[]): Criterion[] {
  const seen = new Set<string>();
  return criteria.map((c, i) => {
    let id = snakeCase(c.id) || `criterion_${i + 1}`;
    while (seen.has(id)) id = `${id}_2`;
    seen.add(id);
    return { ...c, id };
  });
}

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

function defaultDedupKeys(fieldNames: Set<string>): string[][] {
  const keys = [["url"], ["company", "title", "location"]].map((k) => k.filter((f) => fieldNames.has(f)));
  return keys.filter((k) => k.length > 0);
}

const snakeCase = (s: string) =>
  s
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));

function isValidRegex(source: string): boolean {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}
