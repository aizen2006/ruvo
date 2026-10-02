import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "../src/db/client";
import { pages, searchCalls } from "../src/db/schema";
import { FetchError } from "../src/fetch/errors";
import { createFetcher, type FetchRequest, type FetchScope, type FetcherOptions } from "../src/fetch/fetcher";
import { createHostLimiter } from "../src/fetch/hostLimiter";
import { createRobots } from "../src/fetch/robots";
import type { ScraplingClient, ScraplingEngine, ScraplingPage } from "../src/fetch/scrapling";
import { createBudget } from "../src/runs/budget";
import { createMetrics } from "../src/runs/metrics";
import { FirecrawlError, type FirecrawlClient, type ScrapeOptions, type ScrapeResult } from "../src/search/firecrawl";
import { resetDb } from "./helpers/db";

const JOBS_URL = "https://shop.example/jobs";
const fullPage = `<html><body><h1>Jobs</h1><p>${"Backend engineer, remote. ".repeat(40)}</p></body></html>`;
const firecrawlPage = fullPage.replace("Jobs", "Jobs, read by Firecrawl");
const challenge = `<html><head><title>Just a moment...</title></head><body><script>window._cf_chl_opt = {};</script></body></html>`;
const html = (status: number, body: string, headers: Record<string, string> = {}) => ({ status, body, headers: { "content-type": "text/html", ...headers } });
const botCheck = html(403, challenge, { "cf-mitigated": "challenge" });
const down = new FetchError("service_down", "RUVO's fetch service is unreachable", { url: JOBS_URL });
const USD_PER_CREDIT = 0.0032;

/** A fake Scrapling service: one reply per engine, and a log of the engines asked. */
function fakeScrapling(replies: Partial<Record<ScraplingEngine, ReturnType<typeof html> | FetchError>>) {
  const calls: ScraplingEngine[] = [];
  const client: ScraplingClient = {
    async fetch({ url, engine }): Promise<ScraplingPage> {
      calls.push(engine);
      const reply = replies[engine];
      if (!reply) throw new Error(`unexpected ${engine} fetch`);
      if (reply instanceof FetchError) throw reply;
      return { url, ...reply };
    },
    async relocate() {
      throw new Error("unexpected relocate");
    },
  };
  return { client, calls };
}

/** A fake Firecrawl whose scrape answers `reply` (or throws it), one credit a page; logs the options it was given. */
function fakeFirecrawl(reply: ScrapeResult | Error = { document: { rawHtml: firecrawlPage, metadata: { url: JOBS_URL, statusCode: 200 } }, creditsUsed: 1 }) {
  const calls: Array<{ url: string; opts: ScrapeOptions }> = [];
  const client: FirecrawlClient = {
    async search() {
      throw new Error("unexpected search");
    },
    async scrape(url, { signal: _, ...opts } = {}) {
      calls.push({ url, opts });
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
  return { client, calls };
}
const firecrawlReads = (rawHtml: string, statusCode: number): ScrapeResult => ({ document: { rawHtml, metadata: { url: JOBS_URL, statusCode } }, creditsUsed: 1 });

const allowAll = { userAgent: "RUVO-test", fetchText: async () => ({ status: 404, text: "" }) };
const fetcherWith = (scrapling: ScraplingClient, firecrawl: FirecrawlClient | undefined, extra: Partial<FetcherOptions> = {}) =>
  createFetcher({
    userAgent: "RUVO-test",
    cacheMode: "ttl",
    allowPrivateNetwork: true,
    robots: createRobots(allowAll),
    limiter: createHostLimiter({ maxConcurrent: 2, minDelayMs: 0 }),
    scrapling,
    firecrawl: firecrawl && { client: firecrawl, usdPerCredit: USD_PER_CREDIT },
    ...extra,
  });
const scope = ({ maxPages = 20, maxBrowserPages = 5 } = {}): FetchScope => ({
  runId: crypto.randomUUID(),
  signal: new AbortController().signal,
  budget: createBudget({ maxPages, maxBrowserPages, maxLlmCalls: 0, maxDurationMs: 60_000, maxRecords: 1 }),
  metrics: createMetrics(),
});
const req = (mode: FetchRequest["mode"] = "auto", url = JOBS_URL): FetchRequest => ({ url, expect: "html", purpose: "test", mode });
const failure = async (p: Promise<unknown>) => (await p.catch((e: unknown) => e)) as FetchError;
const stored = async () => db.select({ via: pages.via, body: pages.body }).from(pages);
const spent = async () => db.select({ runId: searchCalls.runId, provider: searchCalls.provider, query: searchCalls.query, credits: searchCalls.credits, costUsd: searchCalls.costUsd, hits: searchCalls.hits }).from(searchCalls);

beforeEach(resetDb);

describe("Firecrawl reads the page", () => {
  test("when the fetch service is down, and the page is saved as read by Firecrawl", async () => {
    const scrapling = fakeScrapling({ http: down });
    const firecrawl = fakeFirecrawl();
    const s = scope();
    const page = await fetcherWith(scrapling.client, firecrawl.client).fetch(s, req());

    expect(page).toMatchObject({ via: "firecrawl", fromCache: false, status: 200, finalUrl: JOBS_URL, contentType: "text/html", body: firecrawlPage, escalation: null });
    expect(scrapling.calls).toEqual(["http"]);
    // The whole page as HTML, so the recipes read it like any other.
    expect(firecrawl.calls).toEqual([{ url: JOBS_URL, opts: { formats: ["rawHtml"], onlyMainContent: false } }]);
    expect(await stored()).toEqual([{ via: "firecrawl", body: firecrawlPage }]);
    // It is a browser page in the run's budget, and its credits are charged to the run.
    expect(s.metrics.snapshot()).toMatchObject({ pagesVisited: 1, browserPages: 1 });
    expect(s.budget.left("browserPages")).toBe(4);
    expect(await spent()).toEqual([{ runId: s.runId!, provider: "firecrawl", query: JOBS_URL, credits: 1, costUsd: USD_PER_CREDIT, hits: null }]);
  });

  test("when the stealth browser cannot get past the bot check", async () => {
    const scrapling = fakeScrapling({ http: botCheck, stealth: html(403, challenge) });
    const firecrawl = fakeFirecrawl();
    const page = await fetcherWith(scrapling.client, firecrawl.client).fetch(scope(), req());
    expect(page).toMatchObject({ via: "firecrawl", body: firecrawlPage, escalation: { reason: "a bot check (HTTP 403)" } });
    expect(scrapling.calls).toEqual(["http", "stealth"]);
    expect(firecrawl.calls).toHaveLength(1);
  });

  for (const status of [403, 429]) {
    test(`when the stealth browser gets HTTP ${status}`, async () => {
      const scrapling = fakeScrapling({ http: botCheck, stealth: html(status, "<html>No</html>") });
      const firecrawl = fakeFirecrawl();
      expect(await fetcherWith(scrapling.client, firecrawl.client).fetch(scope(), req())).toMatchObject({ via: "firecrawl" });
      expect(firecrawl.calls).toHaveLength(1);
    });
  }

  test("auto mode reuses a stored Firecrawl copy", async () => {
    const scrapling = fakeScrapling({ http: down });
    const firecrawl = fakeFirecrawl();
    const fetcher = fetcherWith(scrapling.client, firecrawl.client);
    await fetcher.fetch(scope(), req());
    const s = scope();
    expect(await fetcher.fetch(s, req())).toMatchObject({ via: "firecrawl", fromCache: true, body: firecrawlPage });
    expect([scrapling.calls, firecrawl.calls.length]).toEqual([["http"], 1]);
    expect(s.metrics.snapshot().cacheHits).toBe(1);
    expect(await spent()).toHaveLength(1);
  });
});

describe("Firecrawl is never asked", () => {
  /** Fetches with `scrapling`'s replies and a Firecrawl key, and returns the error once Firecrawl was not asked. */
  async function refused(replies: Parameters<typeof fakeScrapling>[0], o: { extra?: Partial<FetcherOptions>; scope?: FetchScope; url?: string } = {}) {
    const firecrawl = fakeFirecrawl();
    const error = await failure(fetcherWith(fakeScrapling(replies).client, firecrawl.client, o.extra).fetch(o.scope ?? scope(), req("auto", o.url)));
    expect(firecrawl.calls).toEqual([]);
    expect(await spent()).toEqual([]);
    return error;
  }

  test("past an HTTP 451, from the plain request or the stealth browser", async () => {
    expect(await refused({ http: html(451, "Unavailable For Legal Reasons") })).toMatchObject({ kind: "http_status", details: { status: 451 } });
    expect(await refused({ http: botCheck, stealth: html(451, challenge) })).toMatchObject({ kind: "http_status", details: { status: 451 } });
  });

  test("for a plain 403 the stealth browser was never asked about", async () => {
    expect(await refused({ http: html(403, "<html>Forbidden</html>") })).toMatchObject({ kind: "http_status", details: { status: 403 } });
  });

  test("when robots.txt refuses the page", async () => {
    const robots = createRobots({ ...allowAll, fetchText: async () => ({ status: 200, text: "User-agent: *\nDisallow: /" }) });
    expect((await refused({ http: down }, { extra: { robots } })).kind).toBe("robots_disallowed");
  });

  test("for a private address", async () => {
    expect((await refused({ http: down }, { extra: { allowPrivateNetwork: false }, url: "http://127.0.0.1:9/jobs" })).kind).toBe("ssrf_blocked");
  });

  test("with the page budget used up", async () => {
    expect((await refused({ http: down }, { scope: scope({ maxPages: 0 }) })).kind).toBe("budget_exhausted");
  });

  test("with the browser page budget used up, the service's failure stands", async () => {
    expect((await refused({ http: down }, { scope: scope({ maxBrowserPages: 0 }) })).kind).toBe("service_down");
  });

  test("for a JSON API (fetcher.json), which is fetched in-process", async () => {
    const api = Bun.serve({ port: 0, fetch: () => Response.json({ error: "forbidden" }, { status: 403 }) });
    try {
      const firecrawl = fakeFirecrawl();
      const fetcher = fetcherWith(fakeScrapling({}).client, firecrawl.client);
      const error = await failure(fetcher.json(scope(), `http://127.0.0.1:${api.port}/api.json`, "test"));
      expect(error).toMatchObject({ kind: "http_status", details: { status: 403 } });
      expect(firecrawl.calls).toEqual([]);
    } finally {
      api.stop(true);
    }
  });

  test("without a key", async () => {
    const fetcher = fetcherWith(fakeScrapling({ http: down }).client, undefined);
    expect((await failure(fetcher.fetch(scope(), req()))).kind).toBe("service_down");
    expect(await failure(fetcher.fetch(scope(), req("firecrawl")))).toMatchObject({ kind: "unsupported_content", message: "Firecrawl is not configured" });
  });
});

describe("when Firecrawl cannot read the page either", () => {
  test("a copy still showing the bot check is not stored, and the stealth browser's failure stands", async () => {
    const firecrawl = fakeFirecrawl(firecrawlReads(challenge, 200));
    const s = scope();
    const error = await failure(fetcherWith(fakeScrapling({ http: botCheck, stealth: html(403, challenge) }).client, firecrawl.client).fetch(s, req()));
    expect(error).toMatchObject({ kind: "http_status", details: { status: 403, challenge: true } });
    expect(error.message).not.toContain("Firecrawl");
    expect(await stored()).toEqual([]);
    // The scrape was still paid for.
    expect(await spent()).toMatchObject([{ runId: s.runId!, credits: 1 }]);
  });

  test("an error status is not stored, and the service's failure stands", async () => {
    const firecrawl = fakeFirecrawl(firecrawlReads(fullPage, 403));
    expect((await failure(fetcherWith(fakeScrapling({ http: down }).client, firecrawl.client).fetch(scope(), req()))).kind).toBe("service_down");
    expect(firecrawl.calls).toHaveLength(1);
    expect(await stored()).toEqual([]);
  });

  test("a failed scrape costs nothing, and the service's failure stands", async () => {
    const firecrawl = fakeFirecrawl(new FirecrawlError(402, "Insufficient credits", false));
    expect((await failure(fetcherWith(fakeScrapling({ http: down }).client, firecrawl.client).fetch(scope(), req()))).kind).toBe("service_down");
    expect(firecrawl.calls).toHaveLength(1);
    expect(await stored()).toEqual([]);
    expect(await spent()).toEqual([]);
  });
});

