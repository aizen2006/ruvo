import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type { AdapterId, DatasetContract, FoundSource, PlanDraft } from "@repo/contracts";
import { createLlmClient } from "../src/llm/client";
import { DEMO_CONTRACT } from "../src/plan/demoContract";
import { addFoundSources, discoverFromSearch, type WebSearch } from "../src/plan/webDiscovery";
import { createBudget } from "../src/runs/budget";
import { createMetrics } from "../src/runs/metrics";
import { createPreparer } from "../src/runs/prepare";
import { startWorker } from "../src/runs/worker";
import { createSearchRunner, type SearchRunner } from "../src/search/cache";
import { createFirecrawl, type SearchResultItem } from "../src/search/firecrawl";
import { resetDb, waitFor } from "./helpers/db";
import { fakeLlm, fakeResponses } from "./helpers/fakeLlm";
import { startTestServer } from "./helpers/http";

const PODCASTS: DatasetContract = {
  ...DEMO_CONTRACT,
  entity: "other",
  entityDescription: "A podcast about climate technology",
  title: "Climate tech podcasts",
  fields: [
    { name: "title", catalogKey: "title", type: "string", required: true, description: "Podcast name" },
    { name: "url", catalogKey: "url", type: "url", required: true, description: "Podcast website" },
  ],
  criteria: [],
  assumptions: [],
  dedupKeys: [["url"]],
  sourceHints: { companies: [], excludeCompanies: [], companyTags: [], urls: [], searchQueries: ["best climate tech podcasts", "climate podcast creators"], includeCommunityBoards: false },
};

const hit = (url: string, title: string, description = ""): SearchResultItem => ({ url, title, description });

const RESULTS: Record<string, SearchResultItem[]> = {
  "best climate tech podcasts": [
    hit("https://www.podlist.example/best-climate-podcasts?utm_source=x", "The 25 Best Climate Tech Podcasts in 2026"),
    hit("https://blocked.example/top-10-climate-shows", "Top 10 climate shows"),
    hit("https://mycleanpod.example/about", "About My Clean Pod", "A weekly show on decarbonisation"),
    hit("https://reports.example/climate.pdf", "Climate report"),
  ],
  "climate podcast creators": [
    hit("https://podlist.example/best-climate-podcasts", "The 25 Best Climate Tech Podcasts in 2026"),
    hit("https://www.instagram.com/climatepod/", "Climate Pod (@climatepod) • Instagram", "24K followers · Weekly climate tech interviews"),
    hit("https://instagram.com/greenmic", "Green Mic (@greenmic)", "8,100 followers"),
    hit("https://www.instagram.com/p/Cxyz123/", "A post"),
    hit("https://x.com/climatepod", "Climate Pod (@climatepod) / X", "Climate tech podcast"),
  ],
};

/** A search runner answering from `results`; queries mapped to an Error fail. */
function fakeSearcher(results: Record<string, SearchResultItem[] | Error>): SearchRunner & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    async run(query) {
      queries.push(query);
      const r = results[query];
      if (r instanceof Error) throw r;
      return { hits: r ?? [], cached: false, costUsd: 0 };
    },
  };
}

const robots = (blockedHosts: string[] = []): WebSearch["robots"] => ({
  check: async (url) => ({ allowed: !blockedHosts.includes(new URL(url).hostname), crawlDelayMs: 0 }),
});

/** The model calls every uncertain hit a single-record page. */
const allRecords = ({ input }: { input: Array<{ content: string }> }) => {
  const { results } = JSON.parse(input.at(-1)!.content) as { results: Array<{ index: number }> };
  return { results: results.map((r) => ({ index: r.index, kind: "record" })) };
};

const scope = (maxSearches = 10) => ({
  signal: new AbortController().signal,
  budget: createBudget({ maxPages: 10, maxBrowserPages: 0, maxLlmCalls: 10, maxSearches, maxDurationMs: 60_000, maxRecords: 100 }),
  metrics: createMetrics(),
});

const ALL_ADAPTERS = new Set<AdapterId>(["html_list", "html_record", "search_hits"]);

beforeEach(resetDb);

describe("discoverFromSearch", () => {
  test("sorts hits into list pages, record pages and profiles; robots-blocked and non-pages are dropped", async () => {
    const llm = fakeLlm({ search_hit_kinds: allRecords });
    const web = { searcher: fakeSearcher(RESULTS), robots: robots(["blocked.example"]) };
    const found = await discoverFromSearch(PODCASTS, web, llm, { runId: crypto.randomUUID(), scope: scope(), resultsPerQuery: 10, available: ALL_ADAPTERS });

    expect(found.sources.map((s) => s.ref)).toEqual([
      "html_list:https://podlist.example/best-climate-podcasts",
      "html_record:https://mycleanpod.example/about",
      "search_hits:instagram.com",
      "search_hits:x.com",
    ]);
    expect(found.sources[0]!.reason).toBe('List page found by searching "best climate tech podcasts"');
    // Profiles on sites that forbid reading keep only their search results; posts are not profiles.
    const instagram = found.sources[2]!;
    expect(instagram.label).toBe("Instagram profiles (search results)");
    expect((instagram.params as { hits: Array<{ url: string }> }).hits.map((h) => h.url)).toEqual([
      "https://instagram.com/climatepod",
      "https://instagram.com/greenmic",
    ]);
    // Only the uncertain hit went to the model.
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]!.input.at(-1)!.content).toContain("mycleanpod.example");
    expect(found.searches).toEqual([
      { query: "best climate tech podcasts", hits: 4, cached: false, error: null },
      { query: "climate podcast creators", hits: 5, cached: false, error: null },
    ]);
  });

  test("offers only sources whose adapter exists", async () => {
    const web = { searcher: fakeSearcher(RESULTS), robots: robots() };
    const found = await discoverFromSearch(PODCASTS, web, fakeLlm({ search_hit_kinds: allRecords }), {
      runId: crypto.randomUUID(),
      scope: scope(),
      resultsPerQuery: 10,
      available: new Set<AdapterId>(["html_list"]),
    });
    expect(found.sources.every((s) => s.adapter === "html_list")).toBe(true);
    expect(found.sources.map((s) => s.label)).toEqual(["podlist.example/best-climate-podcasts", "blocked.example/top-10-climate-shows"]);
  });

  test("a failed search is logged and the others still count; an unanswered model skips uncertain hits", async () => {
    const web = { searcher: fakeSearcher({ ...RESULTS, "best climate tech podcasts": new Error("Firecrawl responded 500") }), robots: robots() };
    const found = await discoverFromSearch(PODCASTS, web, fakeLlm({}), { runId: crypto.randomUUID(), scope: scope(), resultsPerQuery: 10, available: ALL_ADAPTERS });
    expect(found.searches[0]).toMatchObject({ query: "best climate tech podcasts", hits: 0, error: "Firecrawl responded 500" });
    expect(found.sources.map((s) => s.ref)).toEqual(["html_list:https://podlist.example/best-climate-podcasts", "search_hits:instagram.com", "search_hits:x.com"]);
  });

  test("searches through Firecrawl within the budget, and replays cached results for free", async () => {
    let calls = 0;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      calls++;
      const { query } = JSON.parse(init.body as string) as { query: string };
      return Response.json({ success: true, data: { web: RESULTS[query] }, creditsUsed: 2 });
    }) as unknown as typeof fetch;
    const searcher = createSearchRunner({ firecrawl: createFirecrawl({ apiKey: "fc-test", fetchImpl }), usdPerCredit: 0.001, cacheMode: "ttl" });
    const web = { searcher, robots: robots() };
    const run = (maxSearches: number) =>
      discoverFromSearch(PODCASTS, web, fakeLlm({ search_hit_kinds: allRecords }), { runId: crypto.randomUUID(), scope: scope(maxSearches), resultsPerQuery: 10, available: ALL_ADAPTERS });

    const first = await run(1);
    expect(first.searches).toEqual([
      { query: "best climate tech podcasts", hits: 4, cached: false, error: null },
      { query: "climate podcast creators", hits: 0, cached: false, error: "Search budget used up" },
    ]);
    expect(calls).toBe(1);

    // The cached query needs no budget, so the one live search goes to the new query.
    const second = await run(1);
    expect(second.searches.map((s) => s.cached)).toEqual([true, false]);
    expect(calls).toBe(2);
  });
});

describe("addFoundSources", () => {
  const page = (url: string): FoundSource => ({ ref: `html_list:${url}`, adapter: "html_list", label: url, params: { url }, reason: "" });
  const profiles = (...urls: string[]): FoundSource => ({
    ref: "search_hits:instagram.com",
    adapter: "search_hits",
    label: "Instagram",
    params: { site: "instagram.com", hits: urls.map((url) => ({ url, title: "", description: "", query: "q" })) },
    reason: "",
  });

  test("puts new pages first, skips pages already read, and adds new profiles to the site's source", () => {
    const merged = addFoundSources([page("https://a.example"), profiles("https://instagram.com/one")], [
      page("https://a.example"),
      page("https://b.example"),
      profiles("https://instagram.com/one", "https://instagram.com/two"),
    ]);
    expect(merged.map((s) => s.ref)).toEqual(["html_list:https://b.example", "html_list:https://a.example", "search_hits:instagram.com"]);
    expect((merged[2]!.params as { hits: Array<{ url: string }> }).hits.map((h) => h.url)).toEqual(["https://instagram.com/one", "https://instagram.com/two"]);
  });
});

describe("preparing a run with web search", () => {
  const api = startTestServer();
  afterAll(api.close);

  const planAll = ({ input }: { input: Array<{ content: string }> }): PlanDraft => {
    const { candidates } = JSON.parse(input.at(-1)!.content) as { candidates: Array<{ ref: string }> };
    return {
      sources: candidates.map((c) => ({ ref: c.ref, include: true, reason: "test", titleKeywords: [], fetchDetails: false, maxItems: 10 })),
      fieldStrategies: [],
      llmBudget: 5,
      rationale: "test plan",
    };
  };

  // New queries in the order the model thinks of them: planning's second search round gets the first.
  const MORE = ["climate podcast hosts", "climate podcast interviews"];

  const worker = (searchResults: Record<string, SearchResultItem[]>) => {
    const fake = fakeResponses({
      dataset_contract: PODCASTS,
      plan_draft: planAll,
      search_hit_kinds: allRecords,
      // One query already tried (in other letters), and the next new one.
      more_search_queries: ({ input }: { input: Array<{ content: string }> }) => {
        const { tried } = JSON.parse(input.at(-1)!.content) as { tried: string[] };
        return { queries: ["Best climate tech podcasts", ...MORE.filter((q) => !tried.includes(q)).slice(0, 1)] };
      },
    });
    const llm = createLlmClient({
      env: { MODEL_PLANNER: "gpt-6-sol", MODEL_WORKER: "gpt-6-luna", LLM_CACHE_MODE: "off", OPENAI_API_KEY: "x" },
      responses: fake.responses,
    });
    const web = { searcher: fakeSearcher(searchResults), robots: robots() };
    return startWorker({ execute: async () => {}, prepare: createPreparer({ llm, web }), pollMs: 20, heartbeatMs: 50 });
  };
  const prepared = async () => {
    const { body } = await api.post("/api/runs", { prompt: "Find climate tech podcasts" });
    await waitFor(() => api.get(`/api/runs/${body.runId}`).then((r) => r.body.status as string), (s) => s === "awaiting_approval");
    return body.runId as string;
  };

  test("plans the sources search found, records the queries, and keeps removals across edits", async () => {
    const w = worker(RESULTS);
    const runId = await prepared();
    await w.stop();

    const { ir } = (await api.get(`/api/runs/${runId}/workflow`)).body;
    expect(ir.sources.map((s: { ref: string }) => s.ref)).toContain("html_list:https://podlist.example/best-climate-podcasts");
    // A second round searched the model's new query; it found nothing new, so the rounds stopped.
    expect(ir.search.queries.map((q: { query: string }) => q.query)).toEqual([...PODCASTS.sourceHints.searchQueries, "climate podcast hosts"]);
    const events = (await api.get(`/api/runs/${runId}/events`)).body as Array<{ type: string; stage: string }>;
    expect(events.filter((e) => e.type === "discovery.searched").map((e) => e.stage)).toEqual(["discovering", "discovering", "discovering"]);

    const removed = "html_list:https://podlist.example/best-climate-podcasts";
    const res = await api.raw(`/api/runs/${runId}/contract`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contract: PODCASTS, removeSources: [removed] }),
    });
    expect(res.status).toBe(200);
    const edited = (await api.get(`/api/runs/${runId}/workflow`)).body.ir;
    expect(edited.sources.map((s: { ref: string }) => s.ref)).not.toContain(removed);
    expect(edited.sources.length).toBe(ir.sources.length - 1);
    expect(edited.search.queries).toEqual(ir.search.queries);
  });

  test("find more searches with new queries and adds only sources not read yet", async () => {
    const w = worker({
      ...RESULTS,
      "climate podcast interviews": [
        hit("https://podlist.example/best-climate-podcasts", "The 25 Best Climate Tech Podcasts in 2026"),
        hit("https://greenshows.example/directory/climate", "Climate shows"),
      ],
    });
    const runId = await prepared();
    const runStatus = (id: string) => api.get(`/api/runs/${id}`).then((r) => r.body.status as string);
    await api.post(`/api/runs/${runId}/start`);
    await waitFor(() => runStatus(runId), (s) => s === "completed");

    const res = await api.post(`/api/runs/${runId}/more`);
    expect(res.status).toBe(201);
    await waitFor(() => runStatus(res.body.runId), (s) => s === "completed");
    await w.stop();

    const before = (await api.get(`/api/runs/${runId}/workflow`)).body.ir;
    const after = (await api.get(`/api/runs/${res.body.runId}/workflow`)).body.ir;
    expect(after.provenance.plannedBy).toBe("find_more");
    expect(after.search.queries.map((q: { query: string }) => q.query)).toEqual([...PODCASTS.sourceHints.searchQueries, ...MORE]);
    const refs = after.sources.map((s: { ref: string }) => s.ref);
    expect(refs.length).toBe(before.sources.length + 1);
    expect(refs).toContain("html_list:https://greenshows.example/directory/climate");
    expect(refs.filter((r: string) => r === "html_list:https://podlist.example/best-climate-podcasts")).toHaveLength(1);
  });

  test("with nothing found, the run stops for review and says what was searched", async () => {
    const w = worker({});
    const runId = await prepared();
    await w.stop();

    const events = (await api.get(`/api/runs/${runId}/events`)).body as Array<{ type: string; message: string }>;
    const completed = events.find((e) => e.type === "discovery.completed")!;
    expect(completed.message).toContain('searched the web for "best climate tech podcasts", "climate podcast creators"');
  });
});
