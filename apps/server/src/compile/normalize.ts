import type { Criterion, DatasetContract, FieldSpec } from "@repo/contracts";
import { packOf } from "../domains";
import type { DomainPack } from "../domains/types";

/**
 * Deterministic clean-up of a compiled contract, so later stages can rely on its shape
 * regardless of small LLM mistakes, followed by its domain's own defaults. Every repair is
 * reported as a warning. Also used when a user edits a contract before approving a run.
 */
export function normalizeContract(input: DatasetContract, prompt: string): { contract: DatasetContract; warnings: string[] } {
  const warnings: string[] = [];
  const pack = packOf(input);
  if (pack.id !== input.domain) warnings.push(`Read the unknown domain "${input.domain}" as ${pack.id}`);
  const fields = normalizeFields(pack, input, warnings);
  const fieldNames = new Set(fields.map((f) => f.name));
  const nameFor = (catalogKey: string) => fields.find((f) => f.catalogKey === catalogKey)?.name;

  const criteria = uniqueIds(input.criteria)
    .map((c) => repairCriterion(c, fieldNames, nameFor, warnings))
    .filter((c): c is Criterion => c !== null);

  const cleaned: DatasetContract = {
    ...input,
    domain: pack.id,
    sourceHints: {
      ...input.sourceHints,
      urls: normalizeUrls(input.sourceHints.urls, warnings),
      searchQueries: [...new Set(input.sourceHints.searchQueries.map((q) => q.trim()).filter(Boolean))].slice(0, 8),
    },
    fields,
    criteria,
    dedupKeys: usableKeys(input.dedupKeys, fieldNames),
    maxRecords: clamp(Math.round(input.maxRecords || 200), 1, 1000),
    sensitive: [...new Set(input.sensitive.map((s) => s.trim().toLowerCase()).filter(Boolean))],
  };
  const contract = pack.normalize?.(cleaned, { prompt, warnings }) ?? cleaned;
  // Records with the same link are one record, as are records with the same name, unless the domain says what makes one.
  const dedupKeys = usableKeys(contract.dedupKeys.length ? contract.dedupKeys : [["url"], ["title"]], new Set(contract.fields.map((f) => f.name)));
  return { contract: { ...contract, dedupKeys }, warnings };
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

/** Catalog keys of the domain, plus "custom" for any other column and "match_reason", which RUVO writes for every domain. */
const isCatalogKey = (pack: DomainPack, key: string) => key === "custom" || key === "match_reason" || Object.hasOwn(pack.fields, key);

function normalizeFields(pack: DomainPack, input: DatasetContract, warnings: string[]): FieldSpec[] {
  const seen = new Set<string>();
  const fields: FieldSpec[] = [];
  for (const field of input.fields) {
    let name = snakeCase(field.name) || snakeCase(field.catalogKey) || "field";
    while (seen.has(name)) name = `${name}_2`;
    if (name !== field.name) warnings.push(`Renamed field "${field.name}" to "${name}"`);
    seen.add(name);
    const known = isCatalogKey(pack, field.catalogKey);
    if (!known) warnings.push(`Made "${name}" a custom column: "${field.catalogKey}" is not a catalog key of the ${pack.id} domain`);
    fields.push({ ...field, name, catalogKey: known ? field.catalogKey : "custom" });
  }

  // The domain's catalog field for a key, when the contract lacks it.
  const add = (key: string, required: boolean, warning: string) => {
    if (fields.some((f) => f.catalogKey === key) || !Object.hasOwn(pack.fields, key)) return;
    fields.push({ name: key, catalogKey: key, type: key === "url" ? "url" : "string", required, description: pack.fields[key]! });
    warnings.push(warning);
  };
  for (const key of pack.required) add(key, true, `Added missing "${key}" field`);
  // An `equals` criterion on a catalog field the model didn't list (e.g. "preferably remote" with no
  // remote column) would be dropped as unusable; add the field as optional so the preference survives.
  for (const criterion of input.criteria.filter((c) => c.kind === "equals")) {
    for (const key of criterion.fields.filter((f) => !fields.some((x) => x.name === f))) {
      add(key, false, `Added optional "${key}" field for criterion "${criterion.label}"`);
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
  if (criterion.kind === "regex" && !isSafeRegex(values[0]!)) {
    warnings.push(`Dropped criterion "${criterion.label}": invalid, too long or too slow regular expression`);
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

/** Dedup keys made only of fields the contract has. */
const usableKeys = (keys: string[][], fieldNames: Set<string>) => keys.map((key) => key.filter((f) => fieldNames.has(f))).filter((key) => key.length > 0);

const snakeCase = (s: string) =>
  s
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));

/**
 * Criteria regexes run on scraped text on the worker's only thread, so beyond compiling they
 * must be short and backtrack at most polynomially: one unbounded quantifier at most, and no
 * repeated group holding a quantifier or alternation, e.g. `(a+)+`, `(a|a)*` or `.*a.*b`.
 */
export function isSafeRegex(source: string): boolean {
  // Escapes and character classes can't backtrack on their own; drop them before counting.
  const shape = source.replace(/\\./g, "x").replace(/\[[^\]]*\]/g, "x");
  const unbounded = shape.match(/[*+]|\{\d+,\}/g)?.length ?? 0;
  if (source.length > 200 || unbounded > 1 || /\([^)]*[|*+}][^)]*\)[*+{]/.test(shape)) return false;
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}
