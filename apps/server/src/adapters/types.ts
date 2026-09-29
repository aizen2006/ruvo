import { CatalogKey, type AdapterId, type EvidenceMethod, type Locator } from "@repo/contracts";
import type { z } from "zod";
import type { Fetcher, FetchScope } from "../fetch/fetcher";
import type { RunContext } from "../runs/runContext";

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
  fields: Partial<Record<CatalogKey | (string & {}), FieldValue>>;
  /** Long-form text for regex/LLM enrichment and decisions (e.g. the job description). */
  text: { plain: string; sourceUrl: string; pageId: string | null } | null;
  /** Extra source data used by matching (e.g. department, registry tags). */
  meta: Record<string, unknown>;
}

export interface AdapterContext {
  fetcher: Fetcher;
  scope: FetchScope;
  /** The whole run, for adapters that need the contract, the LLM or events (html_list). */
  run?: RunContext;
}

/**
 * A source RUVO knows how to collect from. Adapters map source data onto the
 * job catalog fields and attach evidence for every value they produce.
 */
export interface SourceAdapter<P> {
  id: AdapterId;
  kind: "api" | "html" | "text";
  params: z.ZodType<P>;
  /** Catalog fields this adapter fills directly, and by which method (used by the IR compiler). */
  provides: Partial<Record<CatalogKey, EvidenceMethod>>;
  collect(ctx: AdapterContext, params: P): Promise<Item[]>;
}

/** `provides` for adapters that read whatever columns the request has, by one method. */
export const everyField = (method: EvidenceMethod) =>
  Object.fromEntries(CatalogKey.options.map((key) => [key, method])) as SourceAdapter<unknown>["provides"];
