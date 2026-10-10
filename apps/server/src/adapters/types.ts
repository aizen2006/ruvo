import { CatalogKey, type AdapterId, type EvidenceMethod } from "@repo/contracts";
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
