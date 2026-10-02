import type { RunEvent, Stage } from "@repo/contracts";

/**
 * The run's activity log in everyday words, for the one-line status while collecting.
 * Events without a plain meaning return null and are skipped; the full log stays behind
 * "Show details".
 */

const STAGE_LINE: Partial<Record<Stage, string>> = {
  collecting: "Reading pages",
  extracting: "Filling in missing details",
  validating: "Checking every row against your rules",
  deduplicating: "Removing duplicates",
  done: "Finishing up",
};

const LINE: Record<string, (e: RunEvent) => string | null> = {
  "compile.started": () => "Reading your request",
  "discovery.started": () => "Looking for places to find these",
  "discovery.detected": (e) => e.message,
  "plan.reused": () => "Reusing the plan from a similar list you made before",
  "plan.completed": () => "Plan ready",
  "stage.started": (e) => STAGE_LINE[e.stage] ?? null,
  // "Anthropic: 23 postings found" is already plain.
  "source.collected": (e) => e.message,
  "source.failed": () => "One source couldn't be read; the others carry on",
  "fetch.escalated": (e) =>
    (e.data as { via?: string } | null)?.via === "stealth"
      ? "Opening a page in the stealth browser to get past a bot check"
      : "Opening a page in a browser, because it needs one",
  "recipe.discovered": () => "Learned how to read a new page",
  "recipe.replayed": () => "Reading a page the same way as last time",
  "recipe.failed": () => "A website looks different from last time",
  "repair.decided": () => "A website changed; adjusting to it",
  "repair.applied": () => "Adjusted to the website's new layout",
  "triage.completed": () => "Sorting out which rows match",
  "enrich.completed": () => "Filled in missing details",
  "dedupe.completed": () => "Removed duplicates",
  "budget.exhausted": () => "Reached this mode's limit; finishing with what it has",
  "source.time_limit": () => "Reached the time limit; finishing with what it has",
  "run.summary": () => "Done",
};

export function friendlyLine(event: RunEvent): string | null {
  return LINE[event.type]?.(event) ?? null;
}

/** The most recent event that has a plain meaning. */
export function latestFriendly(events: RunEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const line = friendlyLine(events[i]!);
    if (line) return line;
  }
  return null;
}
