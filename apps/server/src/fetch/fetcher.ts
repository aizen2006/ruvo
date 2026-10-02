import type { RunContext } from "../runs/runContext";
import { createCircuitBreaker, type CircuitBreaker } from "../libs/circuitBreaker";
import { parseRetryAfter, withRetry } from "../libs/retry";
import { recordScrape } from "../search/cache";
import type { FirecrawlClient } from "../search/firecrawl";
import { FetchError } from "./errors";
import { createHostLimiter, type HostLimiter } from "./hostLimiter";
import { findCachedPage, savePage, type CacheMode, type PageRow, type Via } from "./pageCache";
import { readCapped } from "./readCapped";
import { createRobots, type Robots } from "./robots";
import { STEALTH_TIMEOUT_MS, type ScraplingClient, type ScraplingEngine } from "./scrapling";
import { assertPublicUrl } from "./ssrf";
import { assessHtml, hasChallengeMarkers, isBotChallenge } from "./sufficiency";

export interface FetchRequest {
  url: string;
  expect: "json" | "html" | "text";
  /** Short reason shown in logs/events, e.g. "greenhouse board". */
  purpose: string;
  /**
   * http: plain request; browser: render in a browser; stealth: Scrapling's stealth browser; firecrawl: Firecrawl's scrape;
   * auto: http, then the browser if the page is a JS shell. A bot check goes to the stealth browser in any mode, and
   * Firecrawl (with a key) reads a page the stealth browser was refused, or any page while the Scrapling service is down.
   */
  mode?: Via | "auto";
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
  /** Set when a fetch had to move to a stronger method (the browser, or the stealth browser or Firecrawl past a bot check), with the reason. */
  escalation: { reason: string; textLength: number } | null;
}

/** The slice of a run a fetch needs: cancellation, budget and counters, and the run a paid fetch (Firecrawl) is charged to. */
export type FetchScope = Pick<RunContext, "signal" | "budget" | "metrics"> & Partial<Pick<RunContext, "runId">>;

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
  /** RUVO's Scrapling fetch service. Without it (tests), pages are fetched in-process over plain HTTP only. */
  scrapling?: ScraplingClient;
  /** The last way to read a page, when the Scrapling service is down or a site refuses even the stealth browser. */
  firecrawl?: { client: FirecrawlClient; usdPerCredit: number };
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;

type BudgetKey = "pages" | "browserPages";
/** A response as fetched; `challenge` marks a bot check, which is never stored. */
type Fetched = { finalUrl: string; status: number; contentType: string | null; body: string; challenge?: boolean };

/**
 * Polite, cached fetching through RUVO's Scrapling service, moving to a stronger method only when a
 * cheaper one fails: plain HTTP, then a browser for a JavaScript shell, or the stealth browser for a
 * bot check; last, Firecrawl (with a key) when the stealth browser is refused or the Scrapling service is down.
 * Every request passes: cache → SSRF guard → circuit breaker → robots.txt → budget → rate-limited transport.
 */
export function createFetcher(opts: FetcherOptions): Fetcher {
  const robots = opts.robots ?? createRobots({ userAgent: opts.userAgent });
  const limiter = opts.limiter ?? createHostLimiter({ maxConcurrent: 2, minDelayMs: 200 });
  const breaker = opts.breaker ?? createCircuitBreaker({ threshold: 5, cooldownMs: 60_000 });
  const cacheTtlMs = opts.cacheTtlMs ?? 6 * 60 * 60 * 1000;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const engineTimeoutMs: Record<ScraplingEngine, number> = { http: timeoutMs, browser: timeoutMs + 10_000, stealth: STEALTH_TIMEOUT_MS };

  const trusted = new Set(opts.trustedOrigins ?? []);
  const guard = async (url: string) => {
    if (opts.allowPrivateNetwork || trusted.has(new URL(url).origin)) return;
    await assertPublicUrl(url);
  };
  // JSON APIs (no browser needed, bodies up to 40 MB) and trusted origins (the service's guard refuses
  // local addresses) are fetched in-process, as is everything without a service.
  const serviceFor = (req: FetchRequest) => (req.expect === "json" || trusted.has(new URL(req.url).origin) ? undefined : opts.scrapling);

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

  /**
   * One rung of the ladder: the stored copy, or the checks and one fetch the way `via` names.
   * A bot check is never stored: the stealth browser fetches the page instead, once. Firecrawl
   * (a browser page in the budget) reads the page only when Scrapling could not (see firecrawlMayRead).
   */
  async function fetchVia(scope: FetchScope, req: FetchRequest, via: Via): Promise<FetchResult> {
    const service = serviceFor(req);
    if ((via === "browser" || via === "stealth") && !service) throw new FetchError("unsupported_content", "Browser rendering is not configured", { url: req.url });
    if (via === "firecrawl" && !opts.firecrawl) throw new FetchError("unsupported_content", "Firecrawl is not configured", { url: req.url });
    const cached = req.fresh ? null : await fromCache(scope, req.url, via);
    if (cached) return cached;
    const { host, crawlDelayMs } = await preflight(scope, req.url, via === "http" ? ["pages"] : ["pages", "browserPages"]);
    const transport = () => (via === "firecrawl" ? firecrawlGet(scope, req) : service ? scraplingGet(service, scope, req, via) : httpGet(scope, req));
    let response: Fetched;
    try {
      response = await withRetry(() => limiter.run(host, crawlDelayMs, transport, scope.signal), {
        // Only plain requests are retried: a render spends a browser page each time.
        retries: via === "http" ? 2 : 0,
        baseMs: 500,
        maxDelayMs: 30_000,
        shouldRetry: (err) => err instanceof FetchError && err.retryable,
        retryAfterMs: (err) => (err instanceof FetchError ? err.details.retryAfterMs : undefined),
        signal: scope.signal,
      });
    } catch (err) {
      if (err instanceof FetchError && (err.retryable || err.kind === "network")) breaker.recordFailure(host);
      if (!firecrawlMayRead(req, via, err)) throw err;
      // If Firecrawl cannot read the page either, it failed for the reason Scrapling met.
      return fetchVia(scope, req, "firecrawl").catch((failed: unknown) => {
        throw scope.signal.aborted ? failed : err;
      });
    }
    const { challenge, ...fetched } = response;
    if (challenge) {
      const passed = await fetchVia(scope, req, "stealth");
      return { ...passed, escalation: { reason: `a bot check (HTTP ${fetched.status})`, textLength: assessHtml(fetched.body).textLength } };
    }
    breaker.recordSuccess(host);
    scope.metrics.inc("pagesVisited");
    if (via !== "http") scope.metrics.inc("browserPages");
    return toResult(await savePage({ url: req.url, via, ...fetched }), false);
  }

  /**
   * Whether Firecrawl may read a page (never an API) after `via` failed with `err`: the Scrapling service
   * is down, or a site refused even the stealth browser with a bot check, 403 or 429. Never past an HTTP 451.
   */
  function firecrawlMayRead(req: FetchRequest, via: Via, err: unknown): boolean {
    if (!opts.firecrawl || req.expect === "json" || !(err instanceof FetchError)) return false;
    if (err.kind === "service_down") return true;
    const { status, challenge } = err.details;
    return via === "stealth" && err.kind === "http_status" && status !== 451 && (challenge === true || status === 403 || status === 429);
  }

  async function fetchPage(scope: FetchScope, req: FetchRequest): Promise<FetchResult> {
    // A malformed URL (e.g. scraped from a page) fails this page as a FetchError, not the whole source.
    if (!URL.canParse(req.url)) throw new FetchError("ssrf_blocked", `Invalid URL: ${req.url}`, { url: req.url });
    const mode = req.mode ?? "http";
    if (mode !== "auto") return fetchVia(scope, req, mode);

    // auto: a copy from an earlier escalation (past a bot check first, Firecrawl last) beats fetching the page again.
    const escalated = req.fresh
      ? null
      : ((await fromCache(scope, req.url, "stealth")) ?? (await fromCache(scope, req.url, "browser")) ?? (await fromCache(scope, req.url, "firecrawl")));
    if (escalated) return escalated;
    const page = await fetchVia(scope, req, "http");
    // A page from past a bot check, or from Firecrawl, was rendered already.
    if (page.via !== "http" || !serviceFor(req)) return page;
    const verdict = assessHtml(page.body);
    if (verdict.sufficient) return page;
    const rendered = await fetchVia(scope, req, "browser");
    return { ...rendered, escalation: rendered.escalation ?? { reason: verdict.reason!, textLength: verdict.textLength } };
  }

  /**
   * One fetch through the Scrapling service. An error status fails as a FetchError, so error pages are
   * never stored; a bot check met over plain HTTP or in the browser comes back marked for the stealth browser.
   */
  async function scraplingGet(service: ScraplingClient, scope: FetchScope, req: FetchRequest, via: ScraplingEngine): Promise<Fetched> {
    if (via === "http") scope.metrics.inc("httpRequests");
    const res = await service.fetch(
      {
        url: req.url,
        engine: via,
        timeoutMs: engineTimeoutMs[via],
        maxBytes: req.maxBytes ?? DEFAULT_MAX_BYTES,
        accept: via === "http" ? ACCEPT[req.expect] : undefined,
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
    if (!acceptsContentType(req.expect, fetched.contentType)) {
      throw new FetchError("unsupported_content", `Unexpected content-type "${fetched.contentType}" from ${res.url}`, { url: res.url });
    }
    return fetched;
  }

  /** One page read through Firecrawl's scrape, as rendered HTML. Its credits are recorded with the searches, so the run's cost counts them. */
  async function firecrawlGet(scope: FetchScope, req: FetchRequest): Promise<Fetched> {
    const { client, usdPerCredit } = opts.firecrawl!;
    const { document, creditsUsed } = await client.scrape(req.url, { formats: ["rawHtml"], onlyMainContent: false, signal: scope.signal });
    await recordScrape(scope.runId, req.url, creditsUsed, creditsUsed * usdPerCredit);
    const finalUrl = document.metadata?.url ?? req.url;
    const status = document.metadata?.statusCode ?? 200;
    const body = document.rawHtml ?? "";
    const challenge = hasChallengeMarkers(body);
    if (status >= 400 || challenge) {
      throw new FetchError("http_status", `Firecrawl could not read ${finalUrl} (HTTP ${status}${challenge ? ", a bot check" : ""})`, { url: finalUrl, status, challenge });
    }
    const maxBytes = req.maxBytes ?? DEFAULT_MAX_BYTES;
    if (Buffer.byteLength(body) > maxBytes) throw new FetchError("too_large", `Response from ${finalUrl} exceeds ${maxBytes} bytes`, { url: finalUrl });
    return { finalUrl, status, contentType: "text/html", body };
  }

  async function httpGet(scope: FetchScope, req: FetchRequest): Promise<Fetched> {
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
        const next = URL.parse(location, url);
        if (!next) throw new FetchError("ssrf_blocked", `Invalid redirect from ${url}: ${location}`, { url });
        url = next.href;
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

function toResult(page: PageRow & { via: Via }, fromCache: boolean): FetchResult {
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
