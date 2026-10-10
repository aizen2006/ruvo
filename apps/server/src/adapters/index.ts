import type { AdapterId } from "@repo/contracts";
import { PACKS } from "../domains";
import { htmlList } from "./htmlList";
import { htmlRecord } from "./htmlRecord";
import { searchHits } from "./searchHits";
import type { SourceAdapter } from "./types";

/** Every source adapter RUVO can run, keyed by the id used in the Workflow IR: the core ones, which read any page, and each domain pack's own. */
const ADAPTERS = new Map(
  [htmlList, htmlRecord, searchHits, ...PACKS.flatMap((p) => p.adapters ?? [])].map((a) => [a.id, a as SourceAdapter<unknown>] as const),
);

export function getAdapter(id: AdapterId): SourceAdapter<unknown> {
  const adapter = ADAPTERS.get(id);
  if (!adapter) throw new Error(`No adapter registered for "${id}"`);
  return adapter;
}

export const registeredAdapters = () => [...ADAPTERS.values()];
