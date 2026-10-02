import { FetchError, type FetchErrorKind } from "./errors";

/** A plain request with Chrome's fingerprint, a browser, or the stealth browser that gets past bot checks. */
export type ScraplingEngine = "http" | "browser" | "stealth";

/** The stealth browser can spend a minute getting past a Cloudflare check. */
export const STEALTH_TIMEOUT_MS = 90_000;

export interface ScraplingPage {
  status: number;
  /** The final URL, after redirects. */
  url: string;
  /** Lower-case names. */
  headers: Record<string, string>;
  /** Decoded as UTF-8. */
  body: string;
}

export interface ScraplingClient {
  /** One fetch with one engine. An HTTP error status comes back as a page; a failed fetch throws a FetchError. */
  fetch(req: { url: string; engine: ScraplingEngine; timeoutMs: number; maxBytes: number; accept?: string }, signal: AbortSignal): Promise<ScraplingPage>;
}

/** The service's failures as fetch errors; "blocked" means the egress guard refused an internal address. */
const FAILURES: Record<string, FetchErrorKind> = { blocked: "ssrf_blocked", network: "network", timeout: "network", too_large: "too_large" };

/**
 * Client for RUVO's Scrapling fetch service (infra/scrapling/server.py), which makes every connection
 * through the egress guard. Aborting a call cancels the fetch in the service too.
 */
export function createScraplingClient(baseUrl: string): ScraplingClient {
  const endpoint = new URL("/fetch", baseUrl);
  return {
    async fetch(req, signal) {
      let res: Response;
      try {
        res = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...req, accept: req.accept ?? null }),
          signal,
        });
      } catch (err) {
        if (signal.aborted) throw err;
        throw new FetchError("service_down", `RUVO's fetch service at ${baseUrl} is unreachable: ${(err as Error).message}`, { url: req.url });
      }
      const reply = (await res.json().catch(() => ({}))) as Partial<ScraplingPage & { error: string; message: string }>;
      signal.throwIfAborted();
      // The body arrives as base64 and is decoded as UTF-8, like every page RUVO reads (see readCapped).
      if (res.ok && typeof reply.body === "string") return { ...(reply as ScraplingPage), body: new TextDecoder().decode(Buffer.from(reply.body, "base64")) };
      const kind = FAILURES[reply.error ?? ""];
      if (kind) throw new FetchError(kind, `${req.url}: ${reply.message}`, { url: req.url });
      throw new Error(`RUVO's fetch service failed on ${req.url} (HTTP ${res.status}): ${reply.message ?? "unexpected reply"}`);
    },
  };
}
