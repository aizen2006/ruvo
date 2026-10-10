import { beforeEach, describe, expect, test } from "bun:test";
import type { Ats } from "../src/domains/jobs/adapters/ats";
import type { SearchHit } from "../src/adapters/searchHits";
import { createBudget, createMetrics, type EmitInput } from "../src/core/run";
import { searchRounds } from "../src/discover/rounds";
import { boardsFromHits } from "../src/domains/jobs/boards";
import { recordBoards } from "../src/domains/jobs/atsDetect";
import { DEMO_CONTRACT } from "../src/plan/demoContract";
import { listRegistry } from "../src/domains/jobs/registry";
import { createSearchRunner } from "../src/search/cache";
import type { SearchResultItem } from "../src/search/firecrawl";
import { resetDb } from "./helpers/db";
import { fakeLlm } from "./helpers/fakeLlm";

const hit = (url: string, title: string): SearchResultItem => ({ url, title, description: "" });
const onBoards = (words: string) => `${words} (site:greenhouse.io OR site:jobs.ashbyhq.com OR site:jobs.lever.co OR site:apply.workable.com)`;

/** The model calls every unclear hit a page about one record, as it would a posting. */
const allRecords = ({ input }: { input: Array<{ content: string }> }) => {
  const { results } = JSON.parse(input.at(-1)!.content) as { results: Array<{ index: number }> };
  return { results: results.map((r) => ({ index: r.index, kind: "record" })) };
};

beforeEach(resetDb);

describe("search rounds for a job request", () => {
  test("search the boards beside the pages, and every posting found names its board instead of being read", async () => {
    // Boards the registry knows, so nothing is probed.
    await recordBoards(["acme", "delta", "ghost"].map((slug) => ({ name: slug[0]!.toUpperCase() + slug.slice(1), hit: { ats: "greenhouse" as Ats, slug, jobCount: 7 } })));
    const results: Record<string, SearchResultItem[]> = {
      // The first round looks for the request's role (DEMO_CONTRACT: backend, preferably remote).
      [onBoards("Backend remote")]: [hit("https://job-boards.greenhouse.io/acme/jobs/1", "Backend Engineer at Acme"), hit("https://greenhouse.io/blog", "Hiring tips")],
      [DEMO_CONTRACT.entityDescription]: [
        hit("https://remotejobs.example/top-50-backend", "Top 50 remote backend engineer jobs"),
        hit("https://job-boards.greenhouse.io/delta/jobs/5", "Backend Engineer at Delta"),
      ],
      // A later round searches the boards for the model's new queries too, unless one names a site.
      [onBoards("platform engineer")]: [hit("https://job-boards.greenhouse.io/ghost/jobs/3", "Platform Engineer at Ghost")],
    };
    const searched: string[] = [];
    const web = {
      searcher: createSearchRunner({
        searxng: { search: async (query) => (searched.push(query), { web: results[query] ?? [], creditsUsed: 0 }) },
        usdPerCredit: 0,
        cacheMode: "off",
      }),
      robots: { check: async () => ({ allowed: true, crawlDelayMs: 0 }) },
    };
    const llm = fakeLlm({ search_hit_kinds: allRecords, more_search_queries: { queries: ["site:wellfound.com backend engineer", "platform engineer"] } });
    const scope = {
      signal: new AbortController().signal,
      budget: createBudget({ maxPages: 10, maxBrowserPages: 0, maxLlmCalls: 10, maxSearches: 4, maxDurationMs: 60_000, maxRecords: 100 }),
      metrics: createMetrics(),
    };
    const events: EmitInput[] = [];

    const found = await searchRounds(DEMO_CONTRACT, {
      web,
      llm,
      mode: "balanced",
      runId: crypto.randomUUID(),
      scope,
      resultsPerQuery: 10,
      userAgent: "test",
      planned: [],
      emit: (e) => events.push(e),
    });

    // Board searches get at most half the searches left (rounded up), page searches the rest.
    expect(searched).toEqual([onBoards("Backend remote"), DEMO_CONTRACT.entityDescription, onBoards("platform engineer"), "site:wellfound.com backend engineer"]);
    expect(found.sources.map((s) => [s.ref, s.adapter])).toEqual([
      ["greenhouse:acme", "greenhouse"],
      ["greenhouse:delta", "greenhouse"],
      ["html_list:https://remotejobs.example/top-50-backend", "html_list"],
      ["greenhouse:ghost", "greenhouse"],
    ]);
    expect(found.sources[1]!.reason).toBe(`Job board on Greenhouse with 7 postings, found by searching "${DEMO_CONTRACT.entityDescription}"`);
    expect(events.filter((e) => e.type === "discovery.search_round").map((e) => e.message)).toEqual([
      "Search round 1: 2 more companies on Greenhouse, plus 1 more source",
      "Search round 2: 1 more company on Greenhouse",
    ]);
  });
});

describe("boardsFromHits", () => {
  test("skips seen boards unprobed, drops boards without postings, stops at the cap, and adds the rest to the registry", async () => {
    const posting = (url: string, title: string): SearchHit => ({ url, title, description: "", query: "remote backend engineer jobs" });
    const hits = [
      posting("https://jobs.lever.co/known/2", "Backend Engineer - Known"),
      posting("https://jobs.ashbyhq.com/ghost/3", "Backend Engineer @ Ghost"),
      posting("https://apply.workable.com/beta/j/4", "Senior Backend Engineer - Beta"),
      posting("https://job-boards.greenhouse.io/delta/jobs/5", "Backend Engineer at Delta"),
    ];
    /** Boards with postings; any other board has none. */
    const postings: Record<string, number> = { "workable:beta": 5, "greenhouse:delta": 3 };
    const probed: string[] = [];
    const probe = async (ats: Ats, slug: string) => {
      probed.push(`${ats}:${slug}`);
      const jobCount = postings[`${ats}:${slug}`];
      return jobCount ? { ats, slug, jobCount } : null;
    };

    const boards = await boardsFromHits(DEMO_CONTRACT, hits, { seen: new Set(["lever:known"]), max: 1, userAgent: "test", probe });
    expect(probed).toEqual(["ashby:ghost", "workable:beta"]);
    expect(boards.map((b) => [b.ref, b.adapter, b.label])).toEqual([["workable:beta", "workable", "Beta"]]);
    expect(boards[0]!.reason).toBe('Job board on Workable with 5 postings, found by searching "remote backend engineer jobs"');
    expect((await listRegistry()).map((c) => `${c.ats}:${c.slug}`)).toEqual(["workable:beta"]);
  });
});
