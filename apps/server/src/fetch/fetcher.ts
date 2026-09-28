import type { RunContext } from "../runs/runContext";
import { createCircuitBreaker, type CircuitBreaker } from "../libs/circuitBreaker";
import { parseRetryAfter, withRetry } from "../libs/retry";
import type { BrowserPool } from "./browser";
import { FetchError } from "./errors";
import { createHostLimiter, type HostLimiter } from "./hostLimiter";
import { findCachedPage, savePage, type CacheMode, type PageRow, type Via } from "./pageCache";
import { createRobots, type Robots } from "./robots";
import { assertPublicUrl } from "./ssrf";
import { assessHtml } from "./sufficiency";

export interface FetchRequest {
  url: string;
  expect: "json" | "html" | "text";
  /** Short reason shown in logs/events, e.g. "greenhouse board". */
  purpose: string;
  /** http: plain request; browser: render with Playwright; auto: http, then browser if the page is a JS shell. */
  mode?: "http" | "browser" | "auto";
  /** Skip stored copies and fetch again (the new copy is still stored). Used when retrying a failure. */
  fresh?: boolean;
  maxBytes?: number;
}

export interface FetchResult {
  pageId: string;
  url: string;
  finalUrl: string;
  status: number;
  via: Via;
  fromCache: boolean;
  contentType: string | null;
  body: string;
  /** Set when an auto fetch had to switch to the browser, with the reason. */
  escalation: { reason: string; textLength: number } | null;
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
  /** Only for tests: skips the SSRF guard for every URL. */
  allowPrivateNetwork?: boolean;
  /** Origins exempt from the SSRF guard and the page cache, e.g. RUVO's own demo site on localhost. */
  trustedOrigins?: string[];
  timeoutMs?: number;
  robots?: Robots;
  limiter?: HostLimiter;
  breaker?: CircuitBreaker;
  /** Needed for browser and auto fetches. */
  browser?: BrowserPool;
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;

type BudgetKey = "pages" | "browserPages";

/**
 * Polite, cached fetching over HTTP or a headless browser. Every request passes:
 * cache → SSRF guard → circuit breaker → robots.txt → budget → rate-limited transport.
 */
export function createFetcher(opts: FetcherOptions): Fetcher {
  const robots = opts.robots ?? createRobots({ userAgent: opts.userAgent });
  const limiter = opts.limiter ?? createHostLimiter({ maxConcurrent: 2, minDelayMs: 200 });
  const breaker = opts.breaker ?? createCircuitBreaker({ threshold: 5, cooldownMs: 60_000 });
  const cacheTtlMs = opts.cacheTtlMs ?? 6 * 60 * 60 * 1000;
  const timeoutMs = opts.timeoutMs ?? 20_000;

  const trusted = new Set(opts.trustedOrigins ?? []);
  const guard = async (url: string) => {
    if (opts.allowPrivateNetwork || trusted.has(new URL(url).origin)) return;
    await assertPublicUrl(url);
  };

  /** Stored copy of a page for this transport, honouring the cache mode. */
  async function fromCache(scope: FetchScope, url: string, via: Via): Promise<FetchResult | null> {
    // Trusted origins are local (the demo site), cheap to fetch, and change on purpose; never reuse them.
    if (trusted.has(new URL(url).origin) && opts.cacheMode !== "cache_only") return null;
    const cached = await findCachedPage(url, via, opts.cacheMode, cacheTtlMs);
    if (!cached) return null;
    scope.metrics.inc("cacheHits");
    return toResult(cached, true);
  }

  /** The checks every network request passes; returns the host and its crawl delay. */
  async function preflight(scope: FetchScope, url: string, budget: BudgetKey[]) {
    if (opts.cacheMode === "cache_only") throw new FetchError("cache_miss", `Not in cache (cache_only mode): ${url}`, { url });
    await guard(url);
    const host = new URL(url).host;
    if (breaker.isOpen(host)) throw new FetchError("circuit_open", `Skipping ${host}: too many recent failures`, { url });
    const { allowed, crawlDelayMs } = await robots.check(url);
    if (!allowed) throw new FetchError("robots_disallowed", `robots.txt disallows ${url}`, { url });
    const short = budget.find((key) => scope.budget.left(key) < 1);
    if (short) throw new FetchError("budget_exhausted", `${short === "pages" ? "Page" : "Browser page"} budget exhausted for this run`, { url });
    for (const key of budget) scope.budget.take(key);
    return { host, crawlDelayMs };
  }

  async function fetchHttp(scope: FetchScope, req: FetchRequest): Promise<FetchResult> {
    const cached = req.fresh ? null : await fromCache(scope, req.url, "http");
    if (cached) return cached;
    const { host, crawlDelayMs } = await preflight(scope, req.url, ["pages"]);
    try {
      const response = await withRetry(() => limiter.run(host, crawlDelayMs, () => httpGet(scope, req), scope.signal), {
        retries: 2,
        baseMs: 500,
        maxDelayMs: 30_000,
        shouldRetry: (err) => err instanceof FetchError && err.retryable,
        retryAfterMs: (err) => (err instanceof FetchError ? err.details.retryAfterMs : undefined),
        signal: scope.signal,
      });
      breaker.recordSuccess(host);
      scope.metrics.inc("pagesVisited");
      return toResult(await savePage({ url: req.url, via: "http", ...response }), false);
    } catch (err) {
      if (err instanceof FetchError && (err.retryable || err.kind === "network")) breaker.recordFailure(host);
      throw err;
    }
  }

  async function fetchBrowser(scope: FetchScope, req: FetchRequest): Promise<FetchResult> {
    if (!opts.browser) throw new FetchError("unsupported_content", "Browser rendering is not configured", { url: req.url });
    const cached = req.fresh ? null : await fromCache(scope, req.url, "browser");
    if (cached) return cached;
    const { host, crawlDelayMs } = await preflight(scope, req.url, ["pages", "browserPages"]);
    try {
      const rendered = await limiter.run(
        host,
        crawlDelayMs,
        () => opts.browser!.render(req.url, { signal: scope.signal, timeoutMs: timeoutMs + 10_000 }),
        scope.signal,
      );
      breaker.recordSuccess(host);
      scope.metrics.inc("pagesVisited");
      scope.metrics.inc("browserPages");
      const page = await savePage({
        url: req.url,
        finalUrl: rendered.finalUrl,
        via: "browser",
        status: rendered.status,
        contentType: "text/html",
        body: rendered.html,
      });
      return toResult(page, false);
    } catch (err) {
      if (scope.signal.aborted) throw err;
      breaker.recordFailure(host);
      if (err instanceof FetchError) throw err;
      throw new FetchError("network", `Browser could not load ${req.url}: ${(err as Error).message}`, { url: req.url });
    }
  }

  async function fetchPage(scope: FetchScope, req: FetchRequest): Promise<FetchResult> {
    const mode = req.mode ?? "http";
    if (mode === "browser") return fetchBrowser(scope, req);
    if (mode === "http") return fetchHttp(scope, req);

    // auto: a rendered copy from an earlier escalation beats re-fetching the empty shell.
    const rendered = req.fresh ? null : await fromCache(scope, req.url, "browser");
    if (rendered) return rendered;
    const page = await fetchHttp(scope, req);
    const verdict = assessHtml(page.body);
    if (verdict.sufficient || !opts.browser) return page;
    const escalated = await fetchBrowser(scope, req);
    return { ...escalated, escalation: { reason: verdict.reason!, textLength: verdict.textLength } };
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

function toResult(page: PageRow, fromCache: boolean): FetchResult {
  return {
    pageId: page.id,
    url: page.url,
    finalUrl: page.finalUrl,
    status: page.status,
    via: page.via,
    fromCache,
    contentType: page.contentType,
    body: page.body,
    escalation: null,
  };
}
