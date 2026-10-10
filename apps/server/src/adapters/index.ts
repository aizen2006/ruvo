import type { AdapterId } from "@repo/contracts";
import { ashby } from "./ashby";
import { greenhouse } from "./greenhouse";
import { hnWhoIsHiring } from "./hn";
import { htmlList } from "./htmlList";
import { htmlRecord } from "./htmlRecord";
import { lever } from "./lever";
import { searchHits } from "./searchHits";
import type { SourceAdapter } from "./types";
import { workable } from "./workable";

/** Every source adapter RUVO can run, keyed by the id used in the Workflow IR. */
const ADAPTERS = new Map(
  [greenhouse, ashby, lever, workable, hnWhoIsHiring, htmlList, htmlRecord, searchHits].map((a) => [a.id, a as SourceAdapter<unknown>] as const),
);

export function getAdapter(id: AdapterId): SourceAdapter<unknown> {
  const adapter = ADAPTERS.get(id);
  if (!adapter) throw new Error(`No adapter registered for "${id}"`);
  return adapter;
}

export const registeredAdapters = () => [...ADAPTERS.values()];
