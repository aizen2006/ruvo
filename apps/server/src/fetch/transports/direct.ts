import { parseRetryAfter } from "../../libs/retry";
import { FetchError } from "../errors";
import { readCapped } from "../readCapped";
import { assertPublicUrl } from "../ssrf";
import { ACCEPT, acceptsContentType, DEFAULT_MAX_BYTES, type Fetched, type TransportRequest, type TransportScope } from "./types";

/** Redirects followed per request, as RFC 9309 asks for robots.txt. */
const MAX_REDIRECTS = 5;

/** A response that sends the request elsewhere. */
export const isRedirect = (res: Response) => res.status >= 300 && res.status < 400 && Boolean(res.headers.get("location"));

/**
 * A GET from this process. `guard` checks each URL before it is requested, redirects included: the SSRF guard
 * unless the caller trusts the URL, so no hop reaches this machine or its network. Resolves to the last response,
 * whatever its status (a redirect only when there were more than five); a request that fails is a "network"
 * FetchError, unless `signal` cancelled it.
 */
export async function directGet(
  url: string,
  opts: {
    headers: Record<string, string>;
    /** For the whole request, redirects included. */
    timeoutMs: number;
    signal?: AbortSignal;
    guard?: (url: string) => Promise<unknown>;
    /** Called before each request is sent, redirects included. */
    onRequest?: () => void;
  },
): Promise<{ url: string; res: Response }> {
  const { guard = assertPublicUrl } = opts;
  const timeout = AbortSignal.timeout(opts.timeoutMs);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  let target = url;
  await guard(target);
  for (let hop = 0; ; hop++) {
    opts.onRequest?.();
    let res: Response;
    try {
      res = await fetch(target, { redirect: "manual", signal, headers: opts.headers });
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      throw new FetchError("network", `Request to ${target} failed: ${(err as Error).message}`, { url: target });
    }
    if (!isRedirect(res)) return { url: target, res };
    const location = res.headers.get("location")!;
    const next = URL.parse(location, target);
    if (!next) throw new FetchError("ssrf_blocked", `Invalid redirect from ${target}: ${location}`, { url: target });
    await guard(next.href);
    if (hop === MAX_REDIRECTS) return { url: target, res };
    target = next.href;
  }
}

/**
 * The fetcher's plain requests from this process. An error status or an unexpected content type fails as a
 * FetchError, so error pages are never stored. `guard` is the fetcher's SSRF guard, which trusts its demo site.
 */
export function createDirectTransport(opts: { userAgent: string; timeoutMs: number; guard: (url: string) => Promise<void> }) {
  return async (scope: TransportScope, req: TransportRequest): Promise<Fetched> => {
    const { url, res } = await directGet(req.url, {
      headers: { "user-agent": opts.userAgent, accept: ACCEPT[req.expect] },
      timeoutMs: opts.timeoutMs,
      signal: scope.signal,
      guard: opts.guard,
      onRequest: () => scope.metrics.inc("httpRequests"),
    });
    // Still a redirect after five: too many.
    if (isRedirect(res)) throw new FetchError("network", `Too many redirects from ${req.url}`, { url: req.url });
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
  };
}
