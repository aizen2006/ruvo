import type { EvidenceMethod, PageVia, RecordDTO } from "./record";

/**
 * Plain words shared by the dashboard and exported files (docs/design.md, "Words"),
 * so a spreadsheet says the same thing as the screen it was downloaded from.
 */

export type Certainty = "sure" | "likely" | "check";

/** How sure RUVO is of a value, in three plain steps instead of a percentage. */
export function certaintyOf(confidence: number): Certainty {
  if (confidence >= 0.9) return "sure";
  if (confidence >= 0.75) return "likely";
  return "check";
}

export const CERTAINTY_LABEL: Record<Certainty, string> = { sure: "Sure", likely: "Likely", check: "Check this" };

export type LeadTier = "strong" | "good" | "possible";

/**
 * A valid record's lead score, 0–100: half for fit (matchScore, the share of nice-to-have weight it
 * earns) and half for how sure RUVO is of its values (confidence). Strong from 80, Good from 60, else
 * Possible. Lists sort by matchScore + confidence, the same order. Other records aren't leads.
 */
export function leadOf(record: Pick<RecordDTO, "status" | "matchScore" | "confidence">): { score: number; tier: LeadTier } | null {
  if (record.status !== "valid") return null;
  const score = Math.round(50 * (record.matchScore + record.confidence));
  return { score, tier: score >= 80 ? "strong" : score >= 60 ? "good" : "possible" };
}

export const LEAD_TIER_LABEL: Record<LeadTier, string> = { strong: "Strong", good: "Good", possible: "Possible" };

/** Where a value came from, said the way a person would say it. */
export const SOURCE_PHRASE: Record<EvidenceMethod, string> = {
  API: "From the site's data feed",
  JSON_LD: "From the page's listing data",
  EMBEDDED_JSON: "From data inside the page",
  DOM: "Read from the page",
  REGEX: "Found in the text",
  LLM: "Found by AI, quote checked",
  SEARCH: "From search results",
  DERIVED: "Worked out by RUVO",
};

/** How the page behind a value was fetched. */
export const FETCH_PHRASE: Record<PageVia, string> = {
  http: "Read directly",
  browser: "Opened in a browser",
  stealth: "Opened in a stealth browser, past a bot check",
  search: "From search results",
  firecrawl: "Read through Firecrawl",
};
