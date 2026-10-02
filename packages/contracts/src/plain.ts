import type { EvidenceMethod, PageVia } from "./record";

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
