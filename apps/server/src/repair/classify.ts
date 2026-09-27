import { FetchError } from "../fetch/errors";
import type { ReplayResult } from "../recipes/replay";

/** What went wrong with a source, in terms repair can act on. */
export type FailureClass =
  | "BLOCKED" // the site refuses us (403/451/robots): stop, never work around it
  | "RATE_LIMITED" // 429: back off
  | "HTTP_ERROR" // server errors, timeouts, network: retry
  | "EMPTY_RENDER" // the page came back without its content (a JS shell over HTTP)
  | "SELECTOR_MISS" // the recipe's item selector no longer matches
  | "PARTIAL_FILL" // items found, but required fields are missing
  | "BUDGET" // the run's budget is spent
  | "UNKNOWN";

export interface Failure {
  kind: FailureClass;
  detail: string;
}

/** Classifies a fetch error. */
export function classifyError(err: unknown): Failure {
  const message = err instanceof Error ? err.message : String(err);
  if (!(err instanceof FetchError)) return { kind: "UNKNOWN", detail: message };
  switch (err.kind) {
    case "robots_disallowed":
    case "ssrf_blocked":
      return { kind: "BLOCKED", detail: message };
    case "budget_exhausted":
      return { kind: "BUDGET", detail: message };
    case "http_status":
      if (err.blocked) return { kind: "BLOCKED", detail: message };
      if (err.details.status === 429) return { kind: "RATE_LIMITED", detail: message };
      return { kind: "HTTP_ERROR", detail: message };
    default:
      return { kind: "HTTP_ERROR", detail: message };
  }
}

/**
 * Classifies a failed recipe replay. An item selector that matches nothing on a page with
 * almost no text is a rendering problem, not a selector problem.
 */
export function classifyReplay(result: ReplayResult, acceptanceKind: "SELECTOR_MISS" | "PARTIAL_FILL", page: { textLength: number }): FailureClass {
  if (result.itemCount === 0 && page.textLength < 500) return "EMPTY_RENDER";
  return acceptanceKind;
}
