import { withRetry } from "../libs/retry";

/**
 * Client for the Firecrawl API (https://docs.firecrawl.dev). Firecrawl obeys robots.txt and
 * identifies itself, so RUVO uses it as a compliant search / scrape / crawl / extract engine.
 * Every response reports the credits it spent, which RUVO turns into a dollar cost.
 *
 * Only the fields RUVO uses are typed; unknown fields pass through untouched.
 */

export interface FirecrawlOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export class FirecrawlError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "FirecrawlError";
  }
}

/** A page's content in the formats RUVO asked for. */
export interface FirecrawlDocument {
  url?: string;
  title?: string;
  description?: string;
  markdown?: string;
  html?: string;
  rawHtml?: string;
  links?: string[];
  /** Present when a jsonOptions/extract schema was supplied. */
  json?: unknown;
  metadata?: { title?: string; description?: string; sourceURL?: string; url?: string; statusCode?: number };
}

export interface SearchResultItem {
  url: string;
  title: string;
  description: string;
  position?: number;
  /** Present when scrapeOptions were passed. */
  markdown?: string;
  html?: string;
  metadata?: FirecrawlDocument["metadata"];
}

export interface SearchResponse {
  web: SearchResultItem[];
  news: SearchResultItem[];
  images: Array<{ url: string; imageUrl: string; title?: string; position?: number }>;
  creditsUsed: number;
}

export interface ScrapeResult {
  document: FirecrawlDocument;
  creditsUsed: number;
}

export interface MapResult {
  links: Array<{ url: string; title?: string; description?: string }>;
}

export interface CrawlStarted {
  id: string;
  url: string;
}

export interface CrawlStatus {
  status: "scraping" | "completed" | "failed" | "cancelled";
  total: number;
  completed: number;
  creditsUsed: number;
  next?: string | null;
  data: FirecrawlDocument[];
}

export interface ExtractResult {
  data: unknown;
  sources?: Record<string, string[]>;
  creditsUsed: number;
}

/** A subset of Firecrawl's scrape formats and options RUVO needs. */
export interface ScrapeOptions {
  formats?: Array<"markdown" | "html" | "rawHtml" | "links" | { type: "json"; schema?: unknown; prompt?: string }>;
  onlyMainContent?: boolean;
  includeTags?: string[];
  excludeTags?: string[];
  waitFor?: number;
  timeout?: number;
  /** Browser actions before scraping: click, scroll, wait, write, press. */
  actions?: Array<Record<string, unknown>>;
}

export interface FirecrawlClient {
  readonly enabled: true;
  search(query: string, opts?: { limit?: number; sources?: Array<"web" | "news" | "images">; country?: string; tbs?: string; location?: string; scrape?: ScrapeOptions; signal?: AbortSignal }): Promise<SearchResponse>;
  scrape(url: string, opts?: ScrapeOptions & { signal?: AbortSignal }): Promise<ScrapeResult>;
  map(url: string, opts?: { search?: string; limit?: number; includeSubdomains?: boolean; signal?: AbortSignal }): Promise<MapResult>;
  startCrawl(url: string, opts?: { limit?: number; maxDiscoveryDepth?: number; includePaths?: string[]; excludePaths?: string[]; sitemap?: "include" | "skip" | "only"; delay?: number; scrapeOptions?: ScrapeOptions; prompt?: string; signal?: AbortSignal }): Promise<CrawlStarted>;
  crawlStatus(id: string, opts?: { signal?: AbortSignal }): Promise<CrawlStatus>;
  cancelCrawl(id: string, opts?: { signal?: AbortSignal }): Promise<void>;
  extract(opts: { urls: string[]; prompt?: string; schema?: unknown; enableWebSearch?: boolean; signal?: AbortSignal }): Promise<ExtractResult>;
}

const isRetryable = (e: unknown) => e instanceof FirecrawlError && e.retryable;

export function createFirecrawl(opts: FirecrawlOptions): FirecrawlClient {
  const baseUrl = (opts.baseUrl ?? "https://api.firecrawl.dev").replace(/\/$/, "");
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const doFetch = opts.fetchImpl ?? fetch;

  /** One POST/GET to Firecrawl, with retries on 429/5xx and a per-request timeout. */
  async function call<T>(method: "POST" | "GET" | "DELETE", path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    return withRetry(
      async () => {
        const timeout = AbortSignal.timeout(timeoutMs);
        const composite = signal ? AbortSignal.any([signal, timeout]) : timeout;
        let res: Response;
        try {
          res = await doFetch(`${baseUrl}${path}`, {
            method,
            headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: composite,
          });
        } catch (err) {
          if (signal?.aborted) throw err;
          throw new FirecrawlError(0, `Firecrawl request failed: ${err instanceof Error ? err.message : String(err)}`, true);
        }
        const json = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
        if (!res.ok || json?.success === false) {
          const message = json?.error ?? `Firecrawl responded ${res.status}`;
          throw new FirecrawlError(res.status, message, res.status === 429 || res.status >= 500);
        }
        return json as T;
      },
      { retries: 2, baseMs: 500, maxDelayMs: 8_000, shouldRetry: isRetryable, signal },
    );
  }

  return {
    enabled: true,

    async search(query, o = {}) {
      const body = {
        query,
        limit: o.limit ?? 10,
        sources: o.sources ?? ["web"],
        ignoreInvalidURLs: true,
        ...(o.country ? { country: o.country } : {}),
        ...(o.tbs ? { tbs: o.tbs } : {}),
        ...(o.location ? { location: o.location } : {}),
        ...(o.scrape ? { scrapeOptions: o.scrape } : {}),
      };
      const res = await call<{ data: { web?: SearchResultItem[]; news?: SearchResultItem[]; images?: SearchResponse["images"] }; creditsUsed?: number }>("POST", "/v2/search", body, o.signal);
      return {
        web: res.data.web ?? [],
        news: res.data.news ?? [],
        images: res.data.images ?? [],
        creditsUsed: res.creditsUsed ?? 0,
      };
    },

    async scrape(url, o = {}) {
      const { signal, ...options } = o;
      const body = { url, formats: options.formats ?? ["markdown"], onlyMainContent: options.onlyMainContent ?? true, ...options };
      const res = await call<{ data: FirecrawlDocument; creditsUsed?: number }>("POST", "/v2/scrape", body, signal);
      return { document: res.data, creditsUsed: res.creditsUsed ?? 0 };
    },

    async map(url, o = {}) {
      const body = { url, ...(o.search ? { search: o.search } : {}), ...(o.limit ? { limit: o.limit } : {}), includeSubdomains: o.includeSubdomains ?? false };
      const res = await call<{ links: MapResult["links"] }>("POST", "/v2/map", body, o.signal);
      return { links: res.links ?? [] };
    },

    async startCrawl(url, o = {}) {
      const { signal, ...options } = o;
      const res = await call<{ id: string; url: string }>("POST", "/v2/crawl", { url, ...options }, signal);
      return { id: res.id, url: res.url };
    },

    async crawlStatus(id, o = {}) {
      const res = await call<CrawlStatus>("GET", `/v2/crawl/${id}`, undefined, o.signal);
      return res;
    },

    async cancelCrawl(id, o = {}) {
      await call("DELETE", `/v2/crawl/${id}`, undefined, o.signal);
    },

    async extract(o) {
      const { signal, ...body } = o;
      const res = await call<{ data: unknown; sources?: Record<string, string[]>; creditsUsed?: number }>("POST", "/v2/extract", body, signal);
      return { data: res.data, sources: res.sources, creditsUsed: res.creditsUsed ?? 0 };
    },
  };
}

/** Placeholder used when no API key is configured, so callers can check `enabled` before use. */
export const firecrawlDisabled = { enabled: false as const };
export type MaybeFirecrawl = FirecrawlClient | typeof firecrawlDisabled;
