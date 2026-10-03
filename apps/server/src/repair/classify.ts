import { FetchError } from "../fetch/errors";
import { LlmError } from "../llm/client";
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

/**
 * A failure in words a user can act on, e.g. for a source that could not be collected.
 * Technical detail stays in the event data; this is the sentence shown in the dashboard.
 */
export function explainFailure(err: unknown): string {
  if (err instanceof LlmError && err.kind === "budget_exhausted") return "this run's AI call budget ran out before the page could be read";
  if (!(err instanceof FetchError)) return err instanceof Error ? err.message : String(err);
  const host = hostOf(err.details.url);
  switch (err.kind) {
    case "robots_disallowed":
      return `${host}'s robots.txt does not allow automated reading of this page`;
    case "ssrf_blocked":
      // A browser can't tell the guard's refusal from a host it couldn't reach (see infra/scrapling/server.py).
      return "the address points to a private or local network, which RUVO does not read, or could not be reached";
    case "circuit_open":
      return `${host} failed repeatedly, so RUVO is pausing requests to it for a minute`;
    case "budget_exhausted":
      return "this run's page budget ran out";
    case "cache_miss":
      return "the page is not in the offline cache (FETCH_CACHE_MODE=cache_only)";
    case "too_large":
      return "the page is larger than RUVO reads (5 MB)";
    case "unsupported_content":
      return "the address does not return a web page";
    case "network":
      return `${host} did not respond in time`;
    case "service_down":
      return `RUVO's fetch service is not running; "bun run dev" starts it`;
    case "http_status": {
      const status = err.details.status;
      if (status === 451) return "the page is blocked for legal reasons (HTTP 451)";
      if (err.details.challenge) return `${host} refused access: even the stealth browser could not get past its bot check`;
      if (err.blocked || status === 401) return `${host} refused access (HTTP ${status})`;
      if (status === 404 || status === 410) return `the page no longer exists (HTTP ${status})`;
      if (status === 429) return `${host} is limiting requests; try again later`;
      return `${host} returned an error (HTTP ${status})`;
    }
  }
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return "the site";
  }
};
