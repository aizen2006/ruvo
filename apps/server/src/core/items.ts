import type { DatasetContract, EvidenceMethod, Locator } from "@repo/contracts";

/** Provenance for one field value, before it is scored and stored as an evidence row. */
export interface EvidenceDraft {
  method: EvidenceMethod;
  /** Public URL a person can open to see the value (the job page, not the API endpoint). */
  sourceUrl: string;
  /** Stored snapshot (API response or page) the value was read from. */
  pageId: string | null;
  snippet: string;
  locator: Locator;
  /** False only for LLM output whose quote could not be found in the source. */
  verified: boolean;
}

export interface FieldValue {
  value: string | boolean | null;
  evidence: EvidenceDraft;
}

/** One candidate entity (e.g. a job posting) collected from a source, before matching. */
export interface Item {
  /** Stable id within the source (ATS job id, HN comment id, …). */
  externalId: string;
  fields: Partial<Record<string, FieldValue>>;
  /** Long-form text for regex/LLM enrichment and decisions (e.g. the job description). */
  text: { plain: string; sourceUrl: string; pageId: string | null } | null;
  /** Extra source data used by matching (e.g. department, registry tags). */
  meta: Record<string, unknown>;
}

/**
 * Items are keyed by catalog key ("title"); contracts may name columns differently
 * ("role" with catalogKey "title"). This maps a contract field name to the item key.
 */
export function itemKeyFor(contract: DatasetContract, fieldName: string): string {
  const field = contract.fields.find((f) => f.name === fieldName);
  return field && field.catalogKey !== "custom" ? field.catalogKey : fieldName;
}
