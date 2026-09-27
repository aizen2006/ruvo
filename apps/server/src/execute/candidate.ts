import type { RecordStatus, Signal } from "@repo/contracts";
import type { Item } from "../adapters/types";

/**
 * An item moving through a source branch, plus what the pipeline has learned about it.
 * Steps take and return Candidate[]; `store` persists them as records.
 */
export interface Candidate {
  /** `${branchId}:${externalId}`; unique per run, so re-attempts upsert the same record. */
  key: string;
  sourceId: string;
  item: Item;
  signals: Signal[];
  rejectReasons: string[];
  matchScore: number;
  /** Trust in the record: the lowest confidence among its required fields (0..1). */
  confidence: number;
  status: RecordStatus | null;
}

export const toCandidate = (sourceId: string, item: Item): Candidate => ({
  key: `${sourceId}:${item.externalId}`,
  sourceId,
  item,
  signals: [],
  rejectReasons: [],
  matchScore: 0,
  confidence: 0,
  status: null,
});

/** Reads a candidate field's value by catalog key (or custom field name) as text. */
export function fieldText(candidate: Candidate, key: string): string {
  const value = candidate.item.fields[key]?.value;
  return value === null || value === undefined ? "" : String(value);
}
