import { parseRetryAfter } from "../../libs/retry";
import { FetchError } from "../errors";
import { readCapped } from "../readCapped";
import { ACCEPT, acceptsContentType, DEFAULT_MAX_BYTES, type Fetched, type TransportRequest, type TransportScope } from "./types";

const MAX_REDIRECTS = 5;

/**
 * Plain requests from this process. An error status or an unexpected content type fails as a FetchError,
 * so error pages are never stored. `guard` is the fetcher's SSRF guard, asked of every redirect.
 */
export function createDirectTransport(opts: { userAgent: string; timeoutMs: number; guard: (url: string) => Promise<void> }) {
  return async (scope: TransportScope, req: TransportRequest): Promise<Fetched> => {
    const signal = AbortSignal.any([scope.signal, AbortSignal.timeout(opts.timeoutMs)]);
    let url = req.url;

    // Follow redirects by hand so every hop passes the SSRF guard.
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      scope.metrics.inc("httpRequests");
      let res: Response;
      try {
        res = await fetch(url, {
          redirect: "manual",
          signal,
          headers: { "user-agent": opts.userAgent, accept: ACCEPT[req.expect] },
        });
      } catch (err) {
        if (scope.signal.aborted) throw err;
        throw new FetchError("network", `Request to ${url} failed: ${(err as Error).message}`, { url });
      }

      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        const next = URL.parse(location, url);
        if (!next) throw new FetchError("ssrf_blocked", `Invalid redirect from ${url}: ${location}`, { url });
        url = next.href;
        await opts.guard(url);
        continue;
      }
      if (res.status >= 400) {
        throw new FetchError("http_status", `HTTP ${res.status} from ${url}`, {
          url,
          status: res.status,
          retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
        });
      }

      const contentType = res.headers.get("content-type");
      if (!acceptsContentType(req.expect, contentType)) {
        throw new FetchError("unsupported_content", `Unexpected content-type "${contentType}" from ${url}`, { url });
      }
      const body = await readCapped(res, req.maxBytes ?? DEFAULT_MAX_BYTES, url);
      return { finalUrl: url, status: res.status, contentType, body };
    }
    throw new FetchError("network", `Too many redirects from ${req.url}`, { url: req.url });
  };
}
