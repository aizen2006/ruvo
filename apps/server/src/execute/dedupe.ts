import { EVIDENCE_METHODS, type DatasetContract, type EvidenceMethod } from "@repo/contracts";
import { locationBucket } from "../extract/parsers/location";
import { canonicalUrl } from "../libs/url";

/**
 * Deduplication keys and clustering (pure; see steps/dedupe.ts for the database side).
 * Each contract dedup key (e.g. ["url"], ["company","title","location"]) yields a normalized
 * string per record; records sharing any key belong to the same cluster.
 */

export function recordKeys(contract: DatasetContract, data: Record<string, unknown>, specs: string[][]): string[] {
  return specs.map((spec) => {
    const parts = spec.map((name) => normalizeFor(catalogKeyOf(contract, name), data[name]));
    // A key only identifies a record when every part of it is known.
    return parts.every(Boolean) ? `${spec.join("+")}:${parts.join("|")}` : "";
  });
}

export interface DedupeCandidate {
  id: string;
  keys: string[];
  /** Best (lowest) evidence method rank among the record's fields. */
  methodRank: number;
  confidence: number;
  /** Number of non-empty fields. */
  completeness: number;
  createdAt: number;
}

/** Groups records that share any key; returns keeper id → duplicate ids (clusters of one omitted). */
export function clusterDuplicates(records: DedupeCandidate[]): Map<string, string[]> {
  const parent = new Map(records.map((r) => [r.id, r.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };

  const firstWithKey = new Map<string, string>();
  for (const record of records) {
    for (const key of record.keys.filter(Boolean)) {
      const other = firstWithKey.get(key);
      if (other) parent.set(find(record.id), find(other));
      else firstWithKey.set(key, record.id);
    }
  }

  const clusters = new Map<string, DedupeCandidate[]>();
  for (const record of records) {
    const root = find(record.id);
    clusters.set(root, [...(clusters.get(root) ?? []), record]);
  }

  const result = new Map<string, string[]>();
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    const [keeper, ...duplicates] = [...members].sort(preferKeeper);
    result.set(keeper!.id, duplicates.map((d) => d.id));
  }
  return result;
}

/** Best evidence first, then higher confidence, more complete, and earliest collected. */
function preferKeeper(a: DedupeCandidate, b: DedupeCandidate): number {
  return a.methodRank - b.methodRank || b.confidence - a.confidence || b.completeness - a.completeness || a.createdAt - b.createdAt;
}

export const methodRank = (methods: EvidenceMethod[]) =>
  methods.length ? Math.min(...methods.map((m) => EVIDENCE_METHODS.indexOf(m))) : EVIDENCE_METHODS.length;

const catalogKeyOf = (contract: DatasetContract, name: string) => contract.fields.find((f) => f.name === name)?.catalogKey ?? "custom";

const LEGAL_SUFFIX = /\b(inc|incorporated|llc|ltd|limited|gmbh|corp|corporation|co|plc|sa|ag|bv)\b\.?/g;

function normalizeFor(catalogKey: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const text = String(value);
  switch (catalogKey) {
    case "url":
      return canonicalUrl(text) ?? "";
    case "location":
      return locationBucket(text);
    case "company":
      return normalizeText(text.toLowerCase().replace(LEGAL_SUFFIX, ""));
    default:
      return normalizeText(text);
  }
}

/** Lowercase, "&" → "and", "sr" → "senior", punctuation removed, whitespace collapsed. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bsr\b\.?/g, "senior")
    .replace(/\bjr\b\.?/g, "junior")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
