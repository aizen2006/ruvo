import { beforeEach, describe, expect, test } from "bun:test";
import type { Ats } from "../src/adapters/ats";
import { searchRound } from "../src/plan/boardSearch";
import { DEMO_CONTRACT } from "../src/plan/demoContract";
import { listRegistry } from "../src/plan/registry";
import { createBudget } from "../src/runs/budget";
import { createMetrics } from "../src/runs/metrics";
import { createSearchRunner } from "../src/search/cache";
import type { SearchResultItem } from "../src/search/firecrawl";
import { resetDb } from "./helpers/db";
import { fakeLlm } from "./helpers/fakeLlm";

const hit = (url: string, title: string): SearchResultItem => ({ url, title, description: "" });
const onBoards = (words: string) => `${words} (site:greenhouse.io OR site:jobs.ashbyhq.com OR site:jobs.lever.co OR site:apply.workable.com)`;

const RESULTS: Record<string, SearchResultItem[]> = {
  [onBoards("backend engineer")]: [
    hit("https://job-boards.greenhouse.io/acme/jobs/1", "Backend Engineer at Acme"),
    hit("https://jobs.lever.co/known/2", "Backend Engineer - Known"),
    hit("https://jobs.ashbyhq.com/ghost/3", "Backend Engineer @ Ghost"),
  ],
  "remote backend engineer jobs": [
    hit("https://remotejobs.example/top-50-backend", "Top 50 remote backend engineer jobs"),
    hit("https://apply.workable.com/beta/j/4", "Senior Backend Engineer - Beta"),
    hit("https://job-boards.greenhouse.io/delta/jobs/5", "Backend Engineer at Delta"),
  ],
};

/** Boards with postings; any other board has none. */
const POSTINGS: Record<string, number> = { "greenhouse:acme": 12, "workable:beta": 5, "greenhouse:delta": 3 };

/** The model calls every unclear hit a page about one record, as it would a posting. */
const allRecords = ({ input }: { input: Array<{ content: string }> }) => {
  const { results } = JSON.parse(input.at(-1)!.content) as { results: Array<{ index: number }> };
  return { results: results.map((r) => ({ index: r.index, kind: "record" })) };
};

beforeEach(resetDb);

describe("searchRound", () => {
  test("a job request's round adds the boards behind postings either search found, up to the cap, and pages beside them", async () => {
    const searched: string[] = [];
    const searcher = createSearchRunner({
      searxng: {
        async search(query) {
          searched.push(query);
          return { web: RESULTS[query] ?? [], creditsUsed: 0 };
        },
      },
      usdPerCredit: 0,
      cacheMode: "off",
    });
    const probed: string[] = [];
    const probe = async (ats: Ats, slug: string) => {
      probed.push(`${ats}:${slug}`);
      const jobCount = POSTINGS[`${ats}:${slug}`];
      return jobCount ? { ats, slug, jobCount } : null;
    };
    const scope = {
      signal: new AbortController().signal,
      budget: createBudget({ maxPages: 10, maxBrowserPages: 0, maxLlmCalls: 10, maxSearches: 3, maxDurationMs: 60_000, maxRecords: 100 }),
      metrics: createMetrics(),
    };

    const round = await searchRound(DEMO_CONTRACT, { searcher, robots: { check: async () => ({ allowed: true, crawlDelayMs: 0 }) } }, fakeLlm({ search_hit_kinds: allRecords }), {
      runId: crypto.randomUUID(),
      scope,
      resultsPerQuery: 10,
      queries: ["remote backend engineer jobs", "backend engineer salaries"],
      boardWords: ["backend engineer", "site:wellfound.com backend engineer", "platform engineer"],
      seen: new Set(["lever:known"]),
      maxBoards: 2,
      userAgent: "test",
      probe,
    });

    // Of 3 searches the boards get 2 (half, rounded up), never for words naming a site; the pages get the rest.
    expect(searched).toEqual([onBoards("backend engineer"), onBoards("platform engineer"), "remote backend engineer jobs"]);
    expect(round.searches.map((s) => s.hits)).toEqual([3, 0, 3]);
    // The seen board is skipped unprobed, one without postings is dropped, and probing stops at the cap.
    expect(probed).toEqual(["greenhouse:acme", "ashby:ghost", "workable:beta"]);
    expect(round.boards.map((b) => [b.ref, b.adapter, b.label])).toEqual([
      ["greenhouse:acme", "greenhouse", "Acme"],
      ["workable:beta", "workable", "Beta"],
    ]);
    expect(round.boards[1]!.reason).toBe('Job board on Workable with 5 postings, found by searching "remote backend engineer jobs"');
    expect((await listRegistry()).map((c) => `${c.ats}:${c.slug}`)).toEqual(["greenhouse:acme", "workable:beta"]);
    // A posting is never read as a page.
    expect(round.pages.map((p) => p.ref)).toEqual(["html_list:https://remotejobs.example/top-50-backend"]);
  });
});
