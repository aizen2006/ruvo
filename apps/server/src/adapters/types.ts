import type { AdapterId, EvidenceMethod } from "@repo/contracts";
import type { z } from "zod";
import type { Item } from "../core/items";
import type { RunContext } from "../core/run";
import type { Fetcher, FetchScope } from "../fetch/fetcher";

export interface AdapterContext {
  fetcher: Fetcher;
  scope: FetchScope;
  /** The whole run, for adapters that need the contract, the LLM or events (html_list). */
  run?: RunContext;
}

/**
 * A source RUVO knows how to collect from. Adapters map source data onto the
 * catalog fields of a contract's domain and attach evidence for every value they produce.
 */
export interface SourceAdapter<P> {
  id: AdapterId;
  kind: "api" | "html" | "text";
  /** For a text source: the parser that reads each post's structured part, named in its plan's extract_text step. */
  parser?: string;
  params: z.ZodType<P>;
  /** Catalog fields this adapter fills directly, and by which method (used by the IR compiler); "*" stands for every field. */
  provides: Partial<Record<string, EvidenceMethod>>;
  collect(ctx: AdapterContext, params: P): Promise<Item[]>;
}

/** `provides` for adapters that read whatever columns the request has, by one method. */
export const everyField = (method: EvidenceMethod): SourceAdapter<unknown>["provides"] => ({ "*": method });

/** Whether an adapter fills a catalog key itself. */
export const fills = (adapter: SourceAdapter<unknown>, key: string) => Object.hasOwn(adapter.provides, key) || Object.hasOwn(adapter.provides, "*");
