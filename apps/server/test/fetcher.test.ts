import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createBudget, createMetrics } from "../src/core/run";
import { db } from "../src/db/client";
import { pages } from "../src/db/schema";
import type { FetchError } from "../src/fetch/errors";
import { createFetcher, type FetchRequest, type FetchScope } from "../src/fetch/fetcher";
import { getPage, savePage, type CacheMode } from "../src/fetch/pageCache";
import { resetDb } from "./helpers/db";

let flakyCalls = 0;
const html = (body: string) => new Response(body, { headers: { "content-type": "text/html" } });

const site = Bun.serve({
  port: 0,
  fetch(req) {
    switch (new URL(req.url).pathname) {
      case "/robots.txt":
        return new Response("User-agent: *\nDisallow: /private\n");
      case "/ok":
        return html("<html><title>ok</title></html>");
      case "/data":
        return Response.json({ jobs: [1, 2] });
      case "/bad-redirect":
        return new Response(null, { status: 302, headers: { location: "http://[bad" } });
      case "/redirect":
        return new Response(null, { status: 302, headers: { location: "/ok" } });
      // Onto this site under another host name, to a page its robots.txt disallows.
      case "/offsite":
        return new Response(null, { status: 302, headers: { location: `http://127.0.0.1:${new URL(req.url).port}/private/page` } });
      case "/private/page":
        return html("<p>private</p>");
      case "/flaky":
        return ++flakyCalls === 1
          ? new Response("slow down", { status: 429, headers: { "retry-after": "0" } })
          : html("<p>recovered</p>");
      case "/come-back-later":
        return new Response("slow down", { status: 429, headers: { "retry-after": "3600" } });
      case "/nul.html":
        return html("<p>a\u0000b</p>");
      case "/nul.json":
        return Response.json({ title: "a\u0000b", path: "C:\\u0000" });
      case "/big":
        return html("x".repeat(5000));
      default:
        return new Response("missing", { status: 404 });
    }
  },
});
const base = `http://localhost:${site.port}`;
afterAll(() => site.stop());
beforeEach(resetDb);

const scope = (maxPages = 50): FetchScope => ({
  signal: new AbortController().signal,
  budget: createBudget({ maxPages, maxBrowserPages: 0, maxLlmCalls: 0, maxDurationMs: 60_000, maxRecords: 100 }),
  metrics: createMetrics(),
});
const localFetcher = (cacheMode: CacheMode = "ttl") =>
  createFetcher({ userAgent: "RUVO-test", cacheMode, allowPrivateNetwork: true });
const page = (path: string, extra: Partial<FetchRequest> = {}): FetchRequest => ({
  url: `${base}${path}`,
  expect: "html",
  purpose: "test",
  ...extra,
});
const failureKind = async (p: Promise<unknown>) => ((await p.catch((e: unknown) => e)) as FetchError).kind;

describe("fetcher", () => {
  test("fetches, stores a snapshot, then serves it from cache", async () => {
    const fetcher = localFetcher();
    const s = scope();
    const first = await fetcher.fetch(s, page("/ok"));
    const second = await fetcher.fetch(s, page("/ok"));
    expect(first.fromCache).toBe(false);
    expect(second).toMatchObject({ fromCache: true, pageId: first.pageId, body: first.body });
    expect(s.metrics.snapshot()).toMatchObject({ pagesVisited: 1, cacheHits: 1 });
  });

  test("parses JSON", async () => {
    const { data } = await localFetcher().json<{ jobs: number[] }>(scope(), `${base}/data`, "test");
    expect(data.jobs).toEqual([1, 2]);
  });

  test("stores pages containing NUL, raw or JSON-escaped, without it", async () => {
    const fetcher = localFetcher();
    expect((await fetcher.fetch(scope(), page("/nul.html"))).body).toBe("<p>ab</p>");
    const { data, page: stored } = await fetcher.json<{ title: string; path: string }>(scope(), `${base}/nul.json`, "test");
    expect(data).toEqual({ title: "ab", path: "C:\\u0000" });
    expect((await getPage(stored.pageId))?.body).toBe(stored.body);
  });

  test("follows redirects", async () => {
    expect((await localFetcher().fetch(scope(), page("/redirect"))).finalUrl).toBe(`${base}/ok`);
  });

  test("retries a 429 honouring Retry-After", async () => {
    flakyCalls = 0;
    const s = scope();
    const res = await localFetcher().fetch(s, page("/flaky"));
    expect(res.body).toContain("recovered");
    expect(s.metrics.snapshot().httpRequests).toBe(2);
  });

  test("gives up at once on a 429 whose Retry-After outlasts the run's time limit", async () => {
    const s = { ...scope(), endsAt: Date.now() + 60_000 };
    expect(await failureKind(localFetcher().fetch(s, page("/come-back-later")))).toBe("http_status");
    expect(s.metrics.snapshot().httpRequests).toBe(1);
  });

  test("refuses robots-disallowed paths, oversize bodies, 404s and an empty budget", async () => {
    const fetcher = localFetcher();
    expect(await failureKind(fetcher.fetch(scope(), page("/private/x")))).toBe("robots_disallowed");
    expect(await failureKind(fetcher.fetch(scope(), page("/offsite")))).toBe("robots_disallowed");
    expect(await failureKind(fetcher.fetch(scope(), page("/big", { maxBytes: 1000 })))).toBe("too_large");
    expect(await failureKind(fetcher.fetch(scope(), page("/nope")))).toBe("http_status");
    expect(await failureKind(fetcher.fetch(scope(0), page("/ok")))).toBe("budget_exhausted");
  });

  test("fails malformed URLs and redirects as FetchErrors", async () => {
    const fetcher = localFetcher();
    expect(await failureKind(fetcher.fetch(scope(), { ...page("/ok"), url: "http://[bad" }))).toBe("ssrf_blocked");
    expect(await failureKind(fetcher.fetch(scope(), page("/bad-redirect")))).toBe("ssrf_blocked");
  });

  test("cache_only mode never touches the network", async () => {
    expect(await failureKind(localFetcher("cache_only").fetch(scope(), page("/ok")))).toBe("cache_miss");
  });

  test("the SSRF guard blocks local targets by default", async () => {
    const fetcher = createFetcher({ userAgent: "RUVO-test", cacheMode: "off" });
    expect(await failureKind(fetcher.fetch(scope(), page("/ok")))).toBe("ssrf_blocked");
  });
});

describe("stored pages", () => {
  const jobs = { url: "https://shop.example/jobs", finalUrl: "https://shop.example/jobs", via: "http" as const, status: 200, contentType: "text/html", body: "<p>jobs</p>" };

  test("the same body as the newest copy is the same page: that copy is marked fetched again", async () => {
    const first = await savePage(jobs);
    const hourAgo = new Date(Date.now() - 3_600_000);
    await db.update(pages).set({ fetchedAt: hourAgo }).where(eq(pages.id, first.id));
    const again = await savePage(jobs);
    expect(again.id).toBe(first.id);
    expect(again.fetchedAt.getTime()).toBeGreaterThan(hourAgo.getTime());
    expect(await db.select({ id: pages.id }).from(pages)).toHaveLength(1);
  });

  test("a changed body, another fetch method or another final address is a new copy", async () => {
    const first = await savePage(jobs);
    const changed = await savePage({ ...jobs, body: "<p>more jobs</p>" });
    const rendered = await savePage({ ...jobs, body: "<p>more jobs</p>", via: "browser" });
    const moved = await savePage({ ...jobs, body: "<p>more jobs</p>", finalUrl: "https://shop.example/careers" });
    expect(new Set([first.id, changed.id, rendered.id, moved.id]).size).toBe(4);
    // Only the newest copy counts: the first body again is stored again.
    expect((await savePage(jobs)).id).not.toBe(first.id);
  });
});
