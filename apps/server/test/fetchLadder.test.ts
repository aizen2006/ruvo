import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { db } from "../src/db/client";
import { pages } from "../src/db/schema";
import { FetchError } from "../src/fetch/errors";
import { createFetcher, type FetchRequest, type FetchScope, type FetcherOptions } from "../src/fetch/fetcher";
import { createHostLimiter } from "../src/fetch/hostLimiter";
import { savePage } from "../src/fetch/pageCache";
import { createRobots } from "../src/fetch/robots";
import type { ScraplingClient, ScraplingEngine, ScraplingPage } from "../src/fetch/scrapling";
import { createCircuitBreaker } from "../src/libs/circuitBreaker";
import { createBudget } from "../src/runs/budget";
import { createMetrics } from "../src/runs/metrics";
import { resetDb } from "./helpers/db";

const JOBS_URL = "https://shop.example/jobs";
const fullPage = `<html><body><h1>Jobs</h1><p>${"Backend engineer, remote. ".repeat(40)}</p></body></html>`;
const challenge = `<html><head><title>Just a moment...</title></head><body><script>window._cf_chl_opt = {};</script></body></html>`;
const html = (status: number, body: string, headers: Record<string, string> = {}) => ({ status, body, headers: { "content-type": "text/html", ...headers } });
type Reply = ReturnType<typeof html> | FetchError;

/** A fake Scrapling service: one reply per engine, and a log of the engines asked. */
function fakeScrapling(replies: Partial<Record<ScraplingEngine, Reply>>) {
  const calls: ScraplingEngine[] = [];
  const client: ScraplingClient = {
    async fetch({ url, engine }): Promise<ScraplingPage> {
      calls.push(engine);
      const reply = replies[engine];
      if (!reply) throw new Error(`unexpected ${engine} fetch`);
      if (reply instanceof FetchError) throw reply;
      return { url, ...reply };
    },
  };
  return { client, calls };
}

const fetcherWith = (scrapling: ScraplingClient | undefined, extra: Partial<FetcherOptions> = {}) =>
  createFetcher({
    userAgent: "RUVO-test",
    cacheMode: "ttl",
    allowPrivateNetwork: true,
    robots: createRobots({ userAgent: "RUVO-test", fetchText: async () => ({ status: 404, text: "" }) }),
    limiter: createHostLimiter({ maxConcurrent: 2, minDelayMs: 0 }),
    scrapling,
    ...extra,
  });
const scope = (maxBrowserPages = 5): FetchScope => ({
  signal: new AbortController().signal,
  budget: createBudget({ maxPages: 20, maxBrowserPages, maxLlmCalls: 0, maxDurationMs: 60_000, maxRecords: 1 }),
  metrics: createMetrics(),
});
const req = (mode: FetchRequest["mode"], url = JOBS_URL): FetchRequest => ({ url, expect: "html", purpose: "test", mode });
const failure = async (p: Promise<unknown>) => (await p.catch((e: unknown) => e)) as FetchError;
const storedVias = async () => (await db.select({ via: pages.via }).from(pages)).map((p) => p.via);

beforeEach(resetDb);

describe("fetch ladder", () => {
  test("a page with its content stays a plain request", async () => {
    const { client, calls } = fakeScrapling({ http: html(200, fullPage) });
    const s = scope();
    const page = await fetcherWith(client).fetch(s, req("auto"));
    expect(page).toMatchObject({ via: "http", escalation: null, body: fullPage });
    expect(calls).toEqual(["http"]);
    expect(s.metrics.snapshot()).toMatchObject({ pagesVisited: 1, browserPages: 0 });
  });

  test("a bot check goes to the stealth browser once, and only the real page is stored", async () => {
    const { client, calls } = fakeScrapling({ http: html(403, challenge, { "cf-mitigated": "challenge" }), stealth: html(200, fullPage) });
    const s = scope();
    const page = await fetcherWith(client).fetch(s, req("http"));
    expect(page).toMatchObject({ via: "stealth", body: fullPage, escalation: { reason: "a bot check (HTTP 403)" } });
    expect(calls).toEqual(["http", "stealth"]);
    expect(await storedVias()).toEqual(["stealth"]);
    // The stealth browser spends a browser page.
    expect(s.metrics.snapshot()).toMatchObject({ pagesVisited: 1, browserPages: 1 });
    expect(s.budget.left("browserPages")).toBe(4);
  });

  test("a bot check with no browser pages left is a budget failure", async () => {
    const { client, calls } = fakeScrapling({ http: html(503, challenge) });
    expect((await failure(fetcherWith(client).fetch(scope(0), req("http")))).kind).toBe("budget_exhausted");
    expect(calls).toEqual(["http"]);
  });

  test("a stealth result still showing the bot check is an error and is not stored", async () => {
    // Scrapling keeps the cf-mitigated header even on a page it got past, so the body decides.
    const { client, calls } = fakeScrapling({ http: html(403, challenge), stealth: html(200, challenge, { "cf-mitigated": "challenge" }) });
    const error = await failure(fetcherWith(client).fetch(scope(), req("http")));
    expect(error).toMatchObject({ kind: "http_status", details: { challenge: true } });
    expect(error.blocked).toBe(true);
    expect(calls).toEqual(["http", "stealth"]);
    expect(await storedVias()).toEqual([]);
  });

  test("a thin page goes to the browser, which says why", async () => {
    const { client, calls } = fakeScrapling({ http: html(200, `<html><body><div id="root"></div></body></html>`), browser: html(200, fullPage) });
    const s = scope();
    const page = await fetcherWith(client).fetch(s, req("auto"));
    expect(page.via).toBe("browser");
    expect(page.escalation?.reason).toContain("characters of text");
    expect(calls).toEqual(["http", "browser"]);
    expect(s.metrics.snapshot()).toMatchObject({ pagesVisited: 2, browserPages: 1 });
  });

  test("HTTP 451 stops the fetch without trying the stealth browser", async () => {
    const { client, calls } = fakeScrapling({ http: html(451, "Unavailable For Legal Reasons") });
    const error = await failure(fetcherWith(client).fetch(scope(), req("auto")));
    expect(error).toMatchObject({ kind: "http_status", details: { status: 451 } });
    expect(error.blocked).toBe(true);
    expect(calls).toEqual(["http"]);
  });

  test("a browser 403 is an error and is not stored", async () => {
    const { client, calls } = fakeScrapling({ browser: html(403, "Forbidden") });
    expect(await failure(fetcherWith(client).fetch(scope(), req("browser")))).toMatchObject({ kind: "http_status", details: { status: 403 } });
    expect(calls).toEqual(["browser"]);
    expect(await storedVias()).toEqual([]);
  });

  test("auto mode reuses a stored stealth copy first, then a stored browser copy", async () => {
    const stored = (url: string, via: "browser" | "stealth") => savePage({ url, finalUrl: url, via, status: 200, contentType: "text/html", body: fullPage });
    const both = `${JOBS_URL}/both`;
    const browserOnly = `${JOBS_URL}/browser`;
    await stored(both, "browser");
    await stored(both, "stealth");
    await stored(browserOnly, "browser");
    const { client, calls } = fakeScrapling({});
    const fetcher = fetcherWith(client);
    expect(await fetcher.fetch(scope(), req("auto", both))).toMatchObject({ via: "stealth", fromCache: true });
    expect(await fetcher.fetch(scope(), req("auto", browserOnly))).toMatchObject({ via: "browser", fromCache: true });
    expect(calls).toEqual([]);
  });

  test("a fetch service that is down does not count against the site", async () => {
    const breaker = createCircuitBreaker({ threshold: 1, cooldownMs: 60_000 });
    const { client, calls } = fakeScrapling({ http: new FetchError("service_down", "down", { url: JOBS_URL }) });
    const fetcher = fetcherWith(client, { breaker });
    expect((await failure(fetcher.fetch(scope(), req("http")))).kind).toBe("service_down");
    expect(breaker.isOpen("shop.example")).toBe(false);
    expect((await failure(fetcher.fetch(scope(), req("http")))).kind).toBe("service_down");
    // Not retried either: one call per fetch.
    expect(calls).toEqual(["http", "http"]);
  });
});

describe("in-process fetching", () => {
  const site = Bun.serve({ port: 0, fetch: () => new Response("<p>local</p>", { headers: { "content-type": "text/html" } }) });
  const local = `http://127.0.0.1:${site.port}/page`;
  afterAll(() => site.stop());

  test("a trusted origin is fetched in-process even with the service configured", async () => {
    const { client, calls } = fakeScrapling({});
    const fetcher = fetcherWith(client, { allowPrivateNetwork: false, trustedOrigins: [new URL(local).origin] });
    expect(await fetcher.fetch(scope(), req("auto", local))).toMatchObject({ via: "http", body: "<p>local</p>" });
    expect(calls).toEqual([]);
  });

  test("without a service, pages come over plain HTTP and browser modes are refused", async () => {
    const fetcher = fetcherWith(undefined);
    expect(await fetcher.fetch(scope(), req("auto", local))).toMatchObject({ via: "http", body: "<p>local</p>", escalation: null });
    expect(await failure(fetcher.fetch(scope(), req("browser", local)))).toMatchObject({ kind: "unsupported_content" });
  });
});
