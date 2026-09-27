import type { AdapterId } from "@repo/contracts";
import { ashby } from "./ashby";
import { greenhouse } from "./greenhouse";
import { hnWhoIsHiring } from "./hn";
import { lever } from "./lever";
import type { SourceAdapter } from "./types";
import { workable } from "./workable";

/** Every source adapter RUVO can run, keyed by the id used in the Workflow IR. */
const ADAPTERS: Partial<Record<AdapterId, SourceAdapter<unknown>>> = {
  greenhouse: greenhouse as SourceAdapter<unknown>,
  ashby: ashby as SourceAdapter<unknown>,
  lever: lever as SourceAdapter<unknown>,
  workable: workable as SourceAdapter<unknown>,
  hn_whoishiring: hnWhoIsHiring as SourceAdapter<unknown>,
};

export function getAdapter(id: AdapterId): SourceAdapter<unknown> {
  const adapter = ADAPTERS[id];
  if (!adapter) throw new Error(`No adapter registered for "${id}"`);
  return adapter;
}

export const registeredAdapters = () => Object.values(ADAPTERS);
