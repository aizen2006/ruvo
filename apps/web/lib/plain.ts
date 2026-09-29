import type { Certainty, RunStatus } from "@repo/contracts";

/**
 * RUVO's everyday vocabulary (docs/design-system.md, "Words"). The default screens speak in
 * these terms; pipeline names (contract, workflow, recipe, method codes) stay behind "Show details".
 */

export { certaintyOf, CERTAINTY_LABEL, SOURCE_PHRASE, type Certainty } from "@repo/contracts";

export const CERTAINTY_HINT: Record<Certainty, string> = {
  sure: "Read directly from the source's own data",
  likely: "Read from the page and checked against it",
  check: "Found, but worth a quick look before you rely on it",
};

/** The three things a dataset page can be doing, in the order a person meets them. */
export type Phase = "preparing" | "plan" | "collecting" | "list";

export function phaseOf(status: RunStatus): Phase {
  switch (status) {
    case "queued":
    case "compiling":
    case "planning":
      return "preparing";
    case "awaiting_approval":
      return "plan";
    case "queued_run":
    case "running":
      return "collecting";
    default:
      return "list";
  }
}

/** A dataset's status for lists and headers. */
export const DATASET_STATUS: Record<RunStatus, string> = {
  queued: "Getting ready",
  compiling: "Reading your request",
  planning: "Finding sources",
  awaiting_approval: "Check the plan",
  queued_run: "Starting",
  running: "Collecting",
  completed: "Ready",
  failed: "Didn't finish",
  cancelled: "Stopped",
};

/** "up to 4 minutes" from a time budget. */
export function minutesPhrase(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return minutes === 1 ? "up to a minute" : `up to ${minutes} minutes`;
}

/** Dollar amounts for estimates and spend; fractions of a cent read as "under 1¢". */
export const usd = (n: number): string => (n <= 0 ? "$0" : n < 0.01 ? "under 1¢" : `$${n.toFixed(2)}`);

/** An estimate as a person would say it: "about $0.03, at most around $0.05", or just "under 1¢". */
export function costRange(typical: number, high: number): string {
  if (high < 0.01) return "under 1¢";
  return `${typical < 0.01 ? "usually under 1¢" : `about ${usd(typical)}`}, at most around ${usd(high)}`;
}
