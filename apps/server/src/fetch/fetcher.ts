import type { RunContext } from "../core/run";
import { createCircuitBreaker, type CircuitBreaker } from "../libs/circuitBreaker";
import { withRetry } from "../libs/retry";
import type { FirecrawlClient } from "../search/firecrawl";
import { FetchError } from "./errors";
import { createHostLimiter, type HostLimiter } from "./hostLimiter";
import { CACHE_TTL_MS, findCachedPage, savePage, type CacheMode, type PageRow, type Via } from "./pageCache";
import { createRobots, type Robots } from "./robots";
import type { ScraplingClient } from "./scrapling";
import { assertPublicUrl } from "./ssrf";
import { assessHtml } from "./sufficiency";
import { createDirectTransport } from "./transports/direct";
import { createFirecrawlTransport } from "./transports/firecrawl";
import { createScraplingTransport } from "./transports/scrapling";
import type { Expect, Fetched, TransportRequest } from "./transports/types";

export interface FetchRequest {
  url: string;
  expect: Expect;
  /** Short reason shown in logs/events, e.g. "greenhouse board". */
  purpose: string;
  /**
   * http: plain request; browser: render in a browser; stealth: Scrapling's stealth browser; firecrawl: Firecrawl's scrape;
   * auto: http, then the browser if the page is a JS shell. A bot check goes to the stealth browser in any mode, and
   * Firecrawl (with a key) reads a page the stealth browser was refused, or one that needs a browser while the Scrapling
   * service is down (plain requests are then made from this process).
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

/** What a HEAD request tells of a file without reading it; null where its headers don't say. */
export interface HeadResult {
  finalUrl: string;
  status: number;
  contentType: string | null;
  contentLength: number | null;
  /** From Content-Disposition. */
  filename: string | null;
  /** The Last-Modified header, as sent. */
  lastModified: string | null;
}

/**
 * The slice of a run a fetch needs: cancellation, time limit, budget and counters, the run a paid fetch (Firecrawl)
 * is charged to, and its activity log.
 */
export type FetchScope = Pick<RunContext, "signal" | "budget" | "metrics"> & Partial<Pick<RunContext, "runId" | "endsAt" | "emit">>;

export interface Fetcher {
  fetch(scope: FetchScope, req: FetchRequest): Promise<FetchResult>;
  json<T>(scope: FetchScope, url: string, purpose: string, opts?: { maxBytes?: number }): Promise<{ data: T; page: FetchResult }>;
  /**
   * A file's headers from a HEAD request through the fetch service, with a plain fetch's checks and one page of the budget;
   * nothing is stored. A server that doesn't answer HEAD (405 or 501) comes back as its status. Null when the fetch service
   * is off (or down), or the URL is a trusted origin, which the service can't reach.
   */
  head(scope: FetchScope, url: string): Promise<HeadResult | null>;
}

export interface FetcherOptions {
  userAgent: string;
  cacheMode: CacheMode;
  cacheTtlMs?: number;
  /** Only for tests: skips the SSRF guard for every URL. */
  allowPrivateNetwork?: boolean;
  /** Origins exempt from the SSRF guard, robots.txt and the page cache, e.g. RUVO's own demo site on localhost. */
  trustedOrigins?: string[];
  timeoutMs?: number;
  robots?: Robots;
  limiter?: HostLimiter;
  /** In-flight requests allowed on particular hosts instead of two, e.g. the job-board APIs. */
  hostLimits?: Record<string, number>;
  breaker?: CircuitBreaker;
  /** RUVO's Scrapling fetch service. Without it (tests), pages are fetched in-process over plain HTTP only. */
  scrapling?: ScraplingClient;
  /** The last way to read a page, when the Scrapling service is down for a browser read or a site refuses even the stealth browser. */
  firecrawl?: { client: FirecrawlClient; usdPerCredit: number };
}

type BudgetKey = "pages" | "browserPages";

/**
 * Polite, cached fetching through RUVO's Scrapling service, moving to a stronger method only when a
 * cheaper one fails: plain HTTP, then a browser for a JavaScript shell, or the stealth browser for a
 * bot check; last, Firecrawl (with a key) when the stealth browser is refused or the Scrapling service is down.
 * While the service is down, plain requests are made from this process instead.
 * Every request passes: cache → SSRF guard → circuit breaker → robots.txt → budget → rate-limited transport,
 * and a page that ends on another host after a redirect passes that host's circuit breaker and robots.txt too.
 */
export function createFetcher(opts: FetcherOptions): Fetcher {
  const robots = opts.robots ?? createRobots({ userAgent: opts.userAgent, allowPrivateNetwork: opts.allowPrivateNetwork });
  const limiter = opts.limiter ?? createHostLimiter({ maxConcurrent: 2, minDelayMs: 200, perHost: opts.hostLimits });
  const breaker = opts.breaker ?? createCircuitBreaker({ threshold: 5, cooldownMs: 60_000 });
  const cacheTtlMs = opts.cacheTtlMs ?? CACHE_TTL_MS;
  const timeoutMs = opts.timeoutMs ?? 20_000;

  const trusted = new Set(opts.trustedOrigins ?? []);
  const guard = async (url: string) => {
    if (opts.allowPrivateNetwork || trusted.has(new URL(url).origin)) return;
    await assertPublicUrl(url);
  };
  const direct = createDirectTransport({ userAgent: opts.userAgent, timeoutMs, guard });
  const scrapling = opts.scrapling && createScraplingTransport(opts.scrapling, timeoutMs);
  const firecrawl = opts.firecrawl && createFirecrawlTransport(opts.firecrawl);
  // JSON APIs (no browser needed, bodies up to 40 MB) and trusted origins (the service's guard refuses
  // local addresses) are fetched in-process, as is everything without a service.
  const serviceFor = (req: TransportRequest) => (req.expect === "json" || trusted.has(new URL(req.url).origin) ? undefined : scrapling);
  // The activity logs (one a run) already told that the service is down, so each run hears it once.
  const toldServiceDown = new WeakSet<NonNullable<FetchScope["emit"]>>();

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
    const { host, crawlDelayMs } = await checkHost(url);
    const short = budget.find((key) => scope.budget.left(key) < 1);
    if (short) throw new FetchError("budget_exhausted", `${short === "pages" ? "Page" : "Browser page"} budget exhausted for this run`, { url });
    for (const key of budget) scope.budget.take(key);
    return { host, crawlDelayMs };
  }

  /** The circuit breaker and robots.txt of a URL's host, asked before a fetch and of the host a redirect ends on. */
  async function checkHost(url: string) {
    const { host, origin } = new URL(url);
    if (breaker.isOpen(host)) throw new FetchError("circuit_open", `Skipping ${host}: too many recent failures`, { url });
    // robots.txt is never read from a local address, so a trusted origin (RUVO's own demo site) is not asked about.
    const { allowed, crawlDelayMs } = trusted.has(origin) ? { allowed: true, crawlDelayMs: 0 } : await robots.check(url);
    if (!allowed) throw new FetchError("robots_disallowed", `robots.txt disallows ${url}`, { url });
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
    if (via === "firecrawl" && !firecrawl) throw new FetchError("unsupported_content", "Firecrawl is not configured", { url: req.url });
    // A plain or rendered read also takes a stored copy from past a bot check, rather than meet the check again.
    const cached = req.fresh ? null : ((await fromCache(scope, req.url, via)) ?? (via === "http" || via === "browser" ? await fromCache(scope, req.url, "stealth") : null));
    if (cached) return cached;
    const { host, crawlDelayMs } = await preflight(scope, req.url, via === "http" ? ["pages"] : ["pages", "browserPages"]);
    const transport = () => {
      if (via === "firecrawl") return firecrawl!(scope, req);
      if (!service) return direct(scope, req);
      return service(scope, req, via).catch((err: unknown) => readDirectly(scope, req, via, err));
    };
    let response: Fetched;
    try {
      // Only plain requests are retried: a render spends a browser page each time.
      response = await send(scope, host, crawlDelayMs, via === "http" ? 2 : 0, transport);
    } catch (err) {
      if (!firecrawlMayRead(req, via, err)) throw err;
      // If Firecrawl cannot read the page either, it failed for the reason Scrapling met.
      return fetchVia(scope, req, "firecrawl").catch((failed: unknown) => {
        throw scope.signal.aborted ? failed : err;
      });
    }
    const { challenge, ...fetched } = response;
    // The requested host's checks don't cover a redirect onto another host; refused there, the page is not stored.
    if (new URL(fetched.finalUrl).host !== host) await checkHost(fetched.finalUrl);
    if (challenge) {
      const passed = await fetchVia(scope, req, "stealth");
      return { ...passed, escalation: { reason: `a bot check (HTTP ${fetched.status})`, textLength: assessHtml(fetched.body).textLength } };
    }
    breaker.recordSuccess(host);
    scope.metrics.inc("pagesVisited");
    if (via !== "http") scope.metrics.inc("browserPages");
    return toResult(await savePage({ url: req.url, via, ...fetched }), false);
  }

  /** One request through the host's rate limit, retried up to `retries` times; a failure that may be the site's counts against its breaker. */
  async function send(scope: FetchScope, host: string, crawlDelayMs: number, retries: number, transport: () => Promise<Fetched>): Promise<Fetched> {
    try {
      return await withRetry(() => limiter.run(host, crawlDelayMs, transport, scope.signal), {
        retries,
        baseMs: 500,
        maxDelayMs: 30_000,
        shouldRetry: (err) => err instanceof FetchError && err.retryable,
        retryAfterMs: (err) => (err instanceof FetchError ? err.details.retryAfterMs : undefined),
        // In a run, a long Retry-After is waited out if it ends before the time limit, and given up on if not.
        deadline: scope.endsAt,
        signal: scope.signal,
      });
    } catch (err) {
      if (err instanceof FetchError && (err.retryable || err.kind === "network")) breaker.recordFailure(host);
      throw err;
    }
  }

  async function head(scope: FetchScope, url: string): Promise<HeadResult | null> {
    if (!URL.canParse(url)) throw new FetchError("ssrf_blocked", `Invalid URL: ${url}`, { url });
    const req: TransportRequest = { url, expect: "html", method: "HEAD" };
    const service = serviceFor(req);
    if (!service) return null;
    const { host, crawlDelayMs } = await preflight(scope, url, ["pages"]);
    let res: Fetched;
    try {
      res = await send(scope, host, crawlDelayMs, 2, () => service(scope, req, "http"));
    } catch (err) {
      if (!(err instanceof FetchError)) throw err;
      if (err.kind === "service_down") return null;
      const { url: finalUrl, status } = err.details;
      if (status === 405 || status === 501) return { finalUrl, status, contentType: null, contentLength: null, filename: null, lastModified: null };
      throw err;
    }
    if (new URL(res.finalUrl).host !== host) await checkHost(res.finalUrl);
    // HEAD never goes to a browser, so a bot check ends it.
    if (res.challenge) throw new FetchError("http_status", `${res.finalUrl} shows a bot check (HTTP ${res.status})`, { url: res.finalUrl, status: res.status, challenge: true });
    breaker.recordSuccess(host);
    scope.metrics.inc("pagesVisited");
    const { "content-length": length, "content-disposition": disposition, "last-modified": lastModified } = res.headers ?? {};
    return {
      finalUrl: res.finalUrl,
      status: res.status,
      contentType: res.contentType,
      contentLength: length && /^\d+$/.test(length) ? Number(length) : null,
      filename: disposition ? filenameOf(disposition) : null,
      lastModified: lastModified ?? null,
    };
  }

  /**
   * After the Scrapling service failed a read with `err`: when the service is down, a plain request is made from this
   * process instead, and the run's activity log says so once. Any other failure, or a read that needs a browser, stands.
   */
  async function readDirectly(scope: FetchScope, req: FetchRequest, via: Via, err: unknown): Promise<Fetched> {
    if (via !== "http" || !(err instanceof FetchError && err.kind === "service_down")) throw err;
    // The direct request checks every address it is sent to, redirects included, with the SSRF guard (ssrf.ts), but it
    // can't pin the connection to the addresses checked the way the egress guard does, so a DNS rebind goes unseen.
    if (scope.emit && !toldServiceDown.has(scope.emit)) {
      toldServiceDown.add(scope.emit);
      scope.emit({
        stage: "collecting",
        type: "fetch.service_down",
        level: "warn",
        message: "The fetch service isn't running, so pages are read directly; pages that need a browser can't be read",
      });
    }
    return direct(scope, req);
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
    head,
  };
}

/**
 * The file name in a Content-Disposition header: RFC 5987's `filename*=` (charset'language'percent-encoded bytes,
 * e.g. UTF-8''r%C3%A9sum%C3%A9.pdf) over a plain `filename=`, quoted or not.
 */
export function filenameOf(disposition: string): string | null {
  const extended = /\bfilename\*\s*=\s*([^']*)'[^']*'([^\s;]+)/i.exec(disposition);
  if (extended) {
    try {
      const bytes = Buffer.from(extended[2]!.replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))), "latin1");
      return new TextDecoder(extended[1] as Bun.Encoding, { fatal: true }).decode(bytes);
    } catch {
      // An unknown charset, or bytes not in it: the plain name, if there is one.
    }
  }
  const plain = /\bfilename\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^\s;]+))/i.exec(disposition);
  return plain ? (plain[1]?.replace(/\\(.)/g, "$1") ?? plain[2]!) : null;
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
