import type { RunContext } from "../runs/runContext";
import { createCircuitBreaker, type CircuitBreaker } from "../libs/circuitBreaker";
import { parseRetryAfter, withRetry } from "../libs/retry";
import { FetchError } from "./errors";
import { createHostLimiter, type HostLimiter } from "./hostLimiter";
import { findCachedPage, savePage, type CacheMode } from "./pageCache";
import { createRobots, type Robots } from "./robots";
import { assertPublicUrl } from "./ssrf";

export interface FetchRequest {
  url: string;
  expect: "json" | "html" | "text";
  /** Short reason shown in logs/events, e.g. "greenhouse board". */
  purpose: string;
  maxBytes?: number;
}

export interface FetchResult {
  pageId: string;
  url: string;
  finalUrl: string;
  status: number;
  via: "http";
  fromCache: boolean;
  contentType: string | null;
  body: string;
}

/** The slice of a run a fetch needs: cancellation, budget and counters. */
export type FetchScope = Pick<RunContext, "signal" | "budget" | "metrics">;

export interface Fetcher {
  fetch(scope: FetchScope, req: FetchRequest): Promise<FetchResult>;
  json<T>(scope: FetchScope, url: string, purpose: string, opts?: { maxBytes?: number }): Promise<{ data: T; page: FetchResult }>;
}

export interface FetcherOptions {
  userAgent: string;
  cacheMode: CacheMode;
  cacheTtlMs?: number;
  /** Only for tests and the local fixture site: skips the SSRF guard. */
  allowPrivateNetwork?: boolean;
  timeoutMs?: number;
  robots?: Robots;
  limiter?: HostLimiter;
  breaker?: CircuitBreaker;
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;

/**
 * Polite, cached HTTP fetching. Order of checks for each request:
 * cache → SSRF guard → circuit breaker → robots.txt → page budget → rate-limited GET with retries.
 */
export function createFetcher(opts: FetcherOptions): Fetcher {
  const robots = opts.robots ?? createRobots({ userAgent: opts.userAgent });
  const limiter = opts.limiter ?? createHostLimiter({ maxConcurrent: 2, minDelayMs: 200 });
  const breaker = opts.breaker ?? createCircuitBreaker({ threshold: 5, cooldownMs: 60_000 });
  const cacheTtlMs = opts.cacheTtlMs ?? 6 * 60 * 60 * 1000;
  const timeoutMs = opts.timeoutMs ?? 20_000;

  const guard = async (url: string) => {
    if (!opts.allowPrivateNetwork) await assertPublicUrl(url);
  };

  async function fetchPage(scope: FetchScope, req: FetchRequest): Promise<FetchResult> {
    const cached = await findCachedPage(req.url, "http", opts.cacheMode, cacheTtlMs);
    if (cached) {
      scope.metrics.inc("cacheHits");
      return { ...toResult(cached), fromCache: true };
    }
    if (opts.cacheMode === "cache_only") {
      throw new FetchError("cache_miss", `Not in cache (cache_only mode): ${req.url}`, { url: req.url });
    }

    await guard(req.url);
    const host = new URL(req.url).host;
    if (breaker.isOpen(host)) {
      throw new FetchError("circuit_open", `Skipping ${host}: too many recent failures`, { url: req.url });
    }
    const { allowed, crawlDelayMs } = await robots.check(req.url);
    if (!allowed) throw new FetchError("robots_disallowed", `robots.txt disallows ${req.url}`, { url: req.url });
    if (!scope.budget.take("pages")) {
      throw new FetchError("budget_exhausted", "Page budget exhausted for this run", { url: req.url });
    }

    try {
      const response = await withRetry(() => limiter.run(host, crawlDelayMs, () => httpGet(scope, req)), {
        retries: 2,
        baseMs: 500,
        maxDelayMs: 30_000,
        shouldRetry: (err) => err instanceof FetchError && err.retryable,
        retryAfterMs: (err) => (err instanceof FetchError ? err.details.retryAfterMs : undefined),
        signal: scope.signal,
      });
      breaker.recordSuccess(host);
      scope.metrics.inc("pagesVisited");
      const page = await savePage({ url: req.url, via: "http", ...response });
      return { ...toResult(page), fromCache: false };
    } catch (err) {
      if (err instanceof FetchError && (err.retryable || err.kind === "network")) breaker.recordFailure(host);
      throw err;
    }
  }

  async function httpGet(scope: FetchScope, req: FetchRequest) {
    const signal = AbortSignal.any([scope.signal, AbortSignal.timeout(timeoutMs)]);
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
        url = new URL(location, url).href;
        await guard(url);
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
  }

  return {
    fetch: fetchPage,
    async json<T>(scope: FetchScope, url: string, purpose: string, o: { maxBytes?: number } = {}) {
      const page = await fetchPage(scope, { url, expect: "json", purpose, maxBytes: o.maxBytes });
      try {
        return { data: JSON.parse(page.body) as T, page };
      } catch {
        throw new FetchError("unsupported_content", `Invalid JSON from ${url}`, { url });
      }
    },
  };
}

const ACCEPT: Record<FetchRequest["expect"], string> = {
  json: "application/json",
  html: "text/html,application/xhtml+xml",
  text: "text/*",
};

function acceptsContentType(expect: FetchRequest["expect"], contentType: string | null): boolean {
  const type = (contentType ?? "").toLowerCase();
  if (expect === "json") return type.includes("json") || type.startsWith("text/");
  if (expect === "html") return type.includes("html") || type === "";
  return type.startsWith("text/") || type.includes("json") || type.includes("xml");
}

async function readCapped(res: Response, maxBytes: number, url: string): Promise<string> {
  const tooLarge = () => new FetchError("too_large", `Response from ${url} exceeds ${maxBytes} bytes`, { url });
  if (Number(res.headers.get("content-length")) > maxBytes) throw tooLarge();
  if (!res.body) return "";

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function toResult(page: { id: string; url: string; finalUrl: string; status: number; contentType: string | null; body: string }) {
  return {
    pageId: page.id,
    url: page.url,
    finalUrl: page.finalUrl,
    status: page.status,
    via: "http" as const,
    contentType: page.contentType,
    body: page.body,
  };
}
