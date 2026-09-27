import type { FetchResult } from "../fetch/fetcher";
import { formatSalary, type SalaryPeriod } from "../extract/parsers/salary";
import { truncate } from "../libs/text";
import type { FieldValue } from "./types";

/**
 * Helpers adapters use to turn source values into fields with evidence.
 * Keeping evidence construction here guarantees every adapter records it the same way.
 */

const SNIPPET_MAX = 300;

type Scalar = string | boolean | number | null | undefined;

const isEmpty = (v: Scalar) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/**
 * A value read directly from an API response at `jsonPath`. Empty values yield no field.
 * `rawSnippet` shows the source's original text when the stored value is normalized
 * (e.g. value "onsite" read from "On-Site").
 */
export function fromApi(
  value: Scalar,
  page: FetchResult,
  sourceUrl: string,
  jsonPath: string,
  rawSnippet?: string,
): FieldValue | undefined {
  if (isEmpty(value)) return undefined;
  const normalized = typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : value!;
  return {
    value: normalized,
    evidence: {
      method: "API",
      sourceUrl,
      pageId: page.pageId,
      snippet: truncate(rawSnippet ?? String(normalized), SNIPPET_MAX),
      locator: { kind: "jsonPath", value: jsonPath },
      verified: true,
    },
  };
}

/**
 * A value computed from other data (e.g. arrangement inferred from a location string).
 * `basis` is the input it was derived from and `rule` names the derivation.
 */
export function derived(value: Scalar, basis: string, rule: string, sourceUrl: string, pageId: string | null): FieldValue | undefined {
  if (isEmpty(value)) return undefined;
  return {
    value: typeof value === "number" ? String(value) : value!,
    evidence: {
      method: "DERIVED",
      sourceUrl,
      pageId,
      snippet: truncate(basis, SNIPPET_MAX),
      locator: { kind: "derived", value: rule },
      verified: true,
    },
  };
}

/** Structured salary from an API, stored in the same display format the regex parser produces. */
export function salaryFromApi(
  s: { min: number | null; max: number | null; currency: string | null; period: SalaryPeriod },
  page: FetchResult,
  sourceUrl: string,
  jsonPath: string,
): FieldValue | undefined {
  if (s.min === null && s.max === null) return undefined;
  const min = s.min ?? s.max!;
  const max = s.max ?? s.min!;
  return fromApi(formatSalary({ min, max, currency: s.currency, period: s.period }), page, sourceUrl, jsonPath);
}

/** Drops undefined entries so items only carry fields that have values. */
export function compactFields(fields: Record<string, FieldValue | undefined>): Record<string, FieldValue> {
  return Object.fromEntries(Object.entries(fields).filter((e): e is [string, FieldValue] => e[1] !== undefined));
}
