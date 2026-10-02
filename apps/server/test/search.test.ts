import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { asc } from "drizzle-orm";
import { db } from "../src/db/client";
import { searchCalls } from "../src/db/schema";
import type { FetchScope } from "../src/fetch/fetcher";
import { createBudget } from "../src/runs/budget";
import { createMetrics } from "../src/runs/metrics";
import { createSearchRunner, type SearchProvider } from "../src/search/cache";
import type { SearchResultItem } from "../src/search/firecrawl";
import { createSearxng } from "../src/search/searxng";
import { resetDb } from "./helpers/db";

const never = new AbortController().signal;

describe("searxng client", () => {
  // What the fake SearXNG answers next, and the queries it was sent.
  let reply: { status?: number; body?: unknown; delayMs?: number } = {};
  const requested: URL[] = [];
  const searxng = Bun.serve({
    port: 0,
    async fetch(req) {
      requested.push(new URL(req.url));
      if (reply.delayMs) await Bun.sleep(reply.delayMs);
      return Response.json(reply.body ?? {}, { status: reply.status ?? 200 });
    },
  });
  const client = createSearxng(`http://127.0.0.1:${searxng.port}/`);
  afterAll(() => searxng.stop(true));
  beforeEach(() => {
    requested.length = 0;
  });

  test("maps the first results to url, title and description, for free", async () => {
    reply = {
      body: {
        results: [
          { url: "https://a.example", title: "A", content: "about a", engine: "duckduckgo" },
          { url: "https://b.example" },
          { url: "https://c.example", title: "C", content: "about c" },
        ],
        unresponsive_engines: [],
      },
    };
    const res = await client.search("climate podcasts", { limit: 2, signal: never });

    expect(res).toEqual({
      web: [
        { url: "https://a.example", title: "A", description: "about a" },
        { url: "https://b.example", title: "", description: "" },
      ],
      creditsUsed: 0,
    });
    expect(requested[0]!.pathname).toBe("/search");
    expect(Object.fromEntries(requested[0]!.searchParams)).toEqual({ q: "climate podcasts", format: "json" });
  });

  test("nothing found because the engines failed is an error naming them", async () => {
    reply = { body: { results: [], unresponsive_engines: [["google", "CAPTCHA"], ["bing", "too many requests"]] } };
    await expect(client.search("q", { limit: 5, signal: never })).rejects.toThrow("SearXNG found nothing: google (CAPTCHA), bing (too many requests)");
  });

  test("nothing found with every engine answering is an empty answer", async () => {
    reply = { body: { results: [], unresponsive_engines: [] } };
    expect(await client.search("q", { limit: 5, signal: never })).toEqual({ web: [], creditsUsed: 0 });
  });

  test("a 403 says settings.yml must allow the json format", async () => {
    reply = { status: 403, body: {} };
    await expect(client.search("q", { limit: 5, signal: never })).rejects.toThrow("SearXNG responded 403; its settings.yml must allow the json format");
  });

  test("an unreachable SearXNG says to start it with docker compose", async () => {
    const stopped = Bun.serve({ port: 0, fetch: () => new Response() });
    const url = `http://127.0.0.1:${stopped.port}`;
    stopped.stop(true);
    const error = (await createSearxng(url)
      .search("q", { limit: 5, signal: never })
      .catch((e: unknown) => e)) as Error;
    expect(error.message).toStartWith(`SearXNG at ${url} is unreachable`);
    expect(error.message).toEndWith("; start it with docker compose up -d");
  });

  test("the abort signal cancels a search in flight", async () => {
    reply = { delayMs: 2000, body: { results: [], unresponsive_engines: [] } };
    const controller = new AbortController();
    const pending = client.search("q", { limit: 5, signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    const started = Date.now();
    const error = (await pending.catch((e: unknown) => e)) as Error;
    // The caller's abort comes through as itself, not as an unreachable SearXNG.
    expect(error.name).toBe("AbortError");
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("search runner", () => {
  const hits = (provider: string, n = 2): SearchResultItem[] =>
    Array.from({ length: n }, (_, i) => ({ url: `https://${provider}.example/${i}`, title: `${provider} ${i}`, description: "d" }));

  /** A provider that answers with `web` (or throws it), costing `credits`; counts its calls. */
  function provider(web: SearchResultItem[] | Error, credits = 0) {
    const fake = {
      calls: 0,
      async search() {
        fake.calls++;
        if (web instanceof Error) throw web;
        return { web, creditsUsed: credits };
      },
    } satisfies SearchProvider & { calls: number };
    return fake;
  }

  const scope = (maxSearches = 5): FetchScope => ({
    signal: never,
    budget: createBudget({ maxPages: 0, maxBrowserPages: 0, maxLlmCalls: 0, maxSearches, maxDurationMs: 60_000, maxRecords: 1 }),
    metrics: createMetrics(),
  });
  const runner = (deps: { searxng?: SearchProvider; firecrawl?: SearchProvider }) => createSearchRunner({ ...deps, usdPerCredit: 0.002, cacheMode: "ttl" });
  const runId = crypto.randomUUID();
  /** The search_calls rows in order, with the number of hits each recorded. */
  const logged = async () =>
    (await db.select().from(searchCalls).orderBy(asc(searchCalls.createdAt))).map((row) => ({
      provider: row.provider,
      credits: row.credits,
      costUsd: row.costUsd,
      cached: row.cached,
      error: row.error,
      hits: row.hits?.length ?? null,
      runId: row.runId,
    }));

  beforeEach(resetDb);

  test("SearXNG answers first and Firecrawl is not asked", async () => {
    const searxng = provider(hits("searxng"));
    const firecrawl = provider(hits("firecrawl"), 2);
    const s = scope();
    expect(await runner({ searxng, firecrawl }).run("q", { limit: 10, runId, scope: s })).toEqual({ hits: hits("searxng"), cached: false, costUsd: 0 });
    expect(firecrawl.calls).toBe(0);
    expect(s.budget.left("searches")).toBe(4);
    expect(await logged()).toEqual([{ provider: "searxng", credits: 0, costUsd: 0, cached: false, error: null, hits: 2, runId }]);
  });

  test("Firecrawl answers when SearXNG fails, and both calls are recorded", async () => {
    const searxng = provider(new Error("SearXNG found nothing: google (CAPTCHA)"));
    const firecrawl = provider(hits("firecrawl", 3), 2);
    const s = scope();
    const res = await runner({ searxng, firecrawl }).run("q", { limit: 10, runId, scope: s });
    expect(res).toEqual({ hits: hits("firecrawl", 3), cached: false, costUsd: 0.004 });
    // One live search is one unit, whichever provider answered.
    expect(s.budget.left("searches")).toBe(4);
    expect(await logged()).toEqual([
      { provider: "searxng", credits: 0, costUsd: 0, cached: false, error: "SearXNG found nothing: google (CAPTCHA)", hits: null, runId },
      { provider: "firecrawl", credits: 2, costUsd: 0.004, cached: false, error: null, hits: 3, runId },
    ]);
  });

  test("Firecrawl answers when SearXNG finds nothing", async () => {
    const firecrawl = provider(hits("firecrawl"), 1);
    const res = await runner({ searxng: provider([]), firecrawl }).run("q", { limit: 10, runId, scope: scope() });
    expect(res).toMatchObject({ hits: hits("firecrawl"), cached: false, costUsd: 0.002 });
    expect((await logged()).map((r) => [r.provider, r.hits])).toEqual([
      ["searxng", 0],
      ["firecrawl", 2],
    ]);
  });

  test("without a Firecrawl key, SearXNG's answer or error stands", async () => {
    expect(await runner({ searxng: provider([]) }).run("empty", { limit: 10, runId, scope: scope() })).toEqual({ hits: [], cached: false, costUsd: 0 });
    await expect(runner({ searxng: provider(new Error("SearXNG is down")) }).run("down", { limit: 10, runId, scope: scope() })).rejects.toThrow("SearXNG is down");
  });

  test("when both fail, SearXNG's error is raised", async () => {
    const firecrawl = provider(new Error("Firecrawl responded 402"));
    const run = runner({ searxng: provider(new Error("SearXNG is down")), firecrawl }).run("q", { limit: 10, runId, scope: scope() });
    await expect(run).rejects.toThrow("SearXNG is down");
    expect(firecrawl.calls).toBe(1);
    expect((await logged()).map((r) => r.error)).toEqual(["SearXNG is down", "Firecrawl responded 402"]);
  });

  test("with the search budget used up, nobody is asked", async () => {
    const searxng = provider(hits("searxng"));
    const r = runner({ searxng });
    const s = scope(1);
    expect(await r.run("first", { limit: 10, runId, scope: s })).not.toBeNull();
    expect(await r.run("second", { limit: 10, runId, scope: s })).toBeNull();
    expect(searxng.calls).toBe(1);
  });

  test("a cached query replays for free and keeps the provider that answered", async () => {
    const firecrawl = provider(hits("firecrawl"), 2);
    const r = runner({ searxng: provider(new Error("SearXNG is down")), firecrawl });
    await r.run("q", { limit: 10, runId, scope: scope() });

    const searxng = provider(hits("searxng"));
    const s = scope();
    const replayRun = crypto.randomUUID();
    const replay = await runner({ searxng, firecrawl }).run("q", { limit: 10, runId: replayRun, scope: s });
    expect(replay).toEqual({ hits: hits("firecrawl"), cached: true, costUsd: 0 });
    expect([searxng.calls, firecrawl.calls]).toEqual([0, 1]);
    expect(s.budget.left("searches")).toBe(5);
    expect((await logged()).at(-1)).toEqual({ provider: "firecrawl", credits: 0, costUsd: 0, cached: true, error: null, hits: 2, runId: replayRun });
  });
});
