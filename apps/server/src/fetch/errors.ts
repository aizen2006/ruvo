/**
 * Why a fetch failed. The repair stage classifies failures by `kind`, so keep these stable.
 */
export type FetchErrorKind =
  | "ssrf_blocked" // target resolves to a private/loopback address or uses a non-http(s) scheme
  | "robots_disallowed"
  | "circuit_open" // host failed repeatedly; skipped for a cooldown period
  | "budget_exhausted"
  | "cache_miss" // FETCH_CACHE_MODE=cache_only and the page was never fetched
  | "http_status"
  | "network"
  | "too_large"
  | "unsupported_content";

export class FetchError extends Error {
  constructor(
    readonly kind: FetchErrorKind,
    message: string,
    readonly details: { url: string; status?: number; retryAfterMs?: number } = { url: "" },
  ) {
    super(message);
    this.name = "FetchError";
  }

  /** Transient failures worth retrying with backoff. */
  get retryable(): boolean {
    if (this.kind === "network") return true;
    return this.kind === "http_status" && RETRYABLE_STATUS.has(this.details.status ?? 0);
  }

  /** The site is refusing us; stop the source rather than retrying (see repair policy). */
  get blocked(): boolean {
    return this.kind === "http_status" && (this.details.status === 403 || this.details.status === 451);
  }
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
