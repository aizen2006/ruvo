import { parseRetryAfter } from "../../libs/retry";
import { FetchError } from "../errors";
import { STEALTH_TIMEOUT_MS, type ScraplingClient, type ScraplingEngine } from "../scrapling";
import { hasChallengeMarkers, isBotChallenge } from "../sufficiency";
import { ACCEPT, acceptsContentType, DEFAULT_MAX_BYTES, type Fetched, type TransportRequest, type TransportScope } from "./types";

/**
 * One fetch through RUVO's Scrapling service (its client is fetch/scrapling.ts). An error status fails as a FetchError,
 * so error pages are never stored; a bot check met over plain HTTP or in the browser comes back marked for the stealth browser.
 */
export function createScraplingTransport(service: ScraplingClient, timeoutMs: number) {
  const engineTimeoutMs: Record<ScraplingEngine, number> = { http: timeoutMs, browser: timeoutMs + 10_000, stealth: STEALTH_TIMEOUT_MS };

  return async (scope: TransportScope, req: TransportRequest, via: ScraplingEngine): Promise<Fetched> => {
    if (via === "http") scope.metrics.inc("httpRequests");
    const res = await service.fetch(
      {
        url: req.url,
        engine: via,
        timeoutMs: engineTimeoutMs[via],
        maxBytes: req.maxBytes ?? DEFAULT_MAX_BYTES,
        // A HEAD takes a file of any type, with Chrome's own Accept.
        accept: via === "http" && req.method !== "HEAD" ? ACCEPT[req.expect] : undefined,
        method: req.method,
      },
      scope.signal,
    );
    const fetched = {
      finalUrl: res.url,
      status: res.status,
      // A rendered page is HTML, whatever the response's content-type said.
      contentType: via === "http" ? (res.headers["content-type"] ?? null) : "text/html",
      body: res.body,
    };
    if (via !== "stealth" && isBotChallenge(res.status, res.headers, res.body)) return { ...fetched, challenge: true };
    const challenge = via === "stealth" && hasChallengeMarkers(res.body);
    if (res.status >= 400 || challenge) {
      throw new FetchError("http_status", challenge ? `${res.url} still shows a bot check (HTTP ${res.status})` : `HTTP ${res.status} from ${res.url}`, {
        url: res.url,
        status: res.status,
        retryAfterMs: parseRetryAfter(res.headers["retry-after"] ?? null),
        challenge,
      });
    }
    if (req.method === "HEAD") return { ...fetched, headers: res.headers };
    if (!acceptsContentType(req.expect, fetched.contentType)) {
      throw new FetchError("unsupported_content", `Unexpected content-type "${fetched.contentType}" from ${res.url}`, { url: res.url });
    }
    return fetched;
  };
}
