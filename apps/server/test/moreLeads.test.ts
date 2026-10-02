import { beforeEach, describe, expect, test } from "bun:test";
import type { DatasetContract, FoundSource } from "@repo/contracts";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { attachWorkflow, getRunWorkflow, saveContract, saveWorkflow } from "../src/db/repos/workflows";
import { runEvents } from "../src/db/schema";
import { createDecider } from "../src/decide/decider";
import { foundCandidate } from "../src/plan/discovery";
import { DEMO_CONTRACT } from "../src/plan/demoContract";
import { compileIr } from "../src/plan/irCompiler";
import { templateDraft } from "../src/plan/templates";
import { moreLeads } from "../src/runs/moreLeads";
import { createRunContext } from "../src/runs/runContext";
import { createSearchRunner } from "../src/search/cache";
import type { SearchResultItem } from "../src/search/firecrawl";
import { insertRun, resetDb } from "./helpers/db";
import { fakeLlm } from "./helpers/fakeLlm";
import { fixtureFetcher } from "./helpers/fixtures";

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
  sourceHints: { companies: [], excludeCompanies: [], companyTags: [], urls: [], searchQueries: ["best climate tech podcasts"], includeCommunityBoards: false },
};

const listPage = (url: string): FoundSource => ({ ref: `html_list:${url}`, adapter: "html_list", label: url, params: { url }, reason: "test" });
const hit = (url: string, title: string): SearchResultItem => ({ url, title, description: "" });
const PLANNED = "https://podlist.example/best-climate-podcasts";
const NEW = "https://greenshows.example/directory/climate";

/** A run that read one list page found by searching "best climate tech podcasts". */
async function plannedRun(maxLlmCalls = 10) {
  const run = await insertRun({ status: "running" });
  const contractRow = await saveContract({ requestId: run.requestId, contract: PODCASTS, editedBy: "llm" });
  const found = [listPage(PLANNED)];
  const candidates = found.map(foundCandidate);
  const draft = templateDraft(candidates, 40);
  const caps = { maxPages: 50, maxBrowserPages: 0, maxLlmCalls, maxSearches: 5, maxDurationMs: 60_000, maxRecords: 200 };
  const ir = compileIr(PODCASTS, draft, candidates, { caps, provenance: { plannedBy: "template", model: null, reusedFrom: null, parentVersion: null } });
  ir.search = { queries: [{ query: "best climate tech podcasts", hits: 1, cached: false, error: null }], sources: found };
  const workflow = await saveWorkflow({ contractId: contractRow.id, ir, planDraft: draft });
  await attachWorkflow(run.id, workflow.id);

  const llm = fakeLlm({ more_search_queries: { queries: ["Best climate tech podcasts", "climate podcast interviews"] } });
  const ctx = await createRunContext({
    runId: run.id,
    signal: new AbortController().signal,
    contract: PODCASTS,
    ir,
    fetcher: fixtureFetcher({}).fetcher,
    llm,
    decider: createDecider({ provider: null, mode: "off" }),
  });
  return { run, ctx, llm };
}

/** SearXNG answering from `results`, through the real search runner so searches draw on the run's budget. */
const web = (results: Record<string, SearchResultItem[]>) => ({
  searcher: createSearchRunner({ searxng: { search: async (query) => ({ web: results[query] ?? [], creditsUsed: 0 }) }, usdPerCredit: 0, cacheMode: "off" }),
  robots: { check: async () => ({ allowed: true, crawlDelayMs: 0 }) },
});

const messages = async (runId: string) => (await db.select().from(runEvents).where(eq(runEvents.runId, runId)).orderBy(runEvents.seq)).map((e) => e.message);

beforeEach(resetDb);

describe("moreLeads", () => {
  test("searches with new queries, saves the new sources as a workflow version and returns only them", async () => {
    const { run, ctx, llm } = await plannedRun();
    const llmCalls = ctx.budget.left("llmCalls");
    const more = moreLeads(web({ "climate podcast interviews": [hit(PLANNED, "The 25 Best Climate Tech Podcasts"), hit(NEW, "Climate shows")] }), "balanced");

    const added = await more(ctx, 2);
    await ctx.dispose();

    expect(added.map((b) => b.ref)).toEqual([`html_list:${NEW}`]);
    // The model saw every query tried so far; the one it repeated was dropped.
    expect(JSON.parse(llm.calls[0]!.input.at(-1)!.content).tried).toEqual(["best climate tech podcasts"]);
    expect(ctx.budget.left("llmCalls")).toBe(llmCalls - 1);
    expect(ctx.budget.left("searches")).toBe(4);

    const { ir, version } = await getRunWorkflow(run.id);
    expect(version).toBe(2);
    expect(ir.provenance.plannedBy).toBe("more_leads");
    expect(ir.sources.map((s) => s.ref).sort()).toEqual([`html_list:${NEW}`, `html_list:${PLANNED}`]);
    expect(ir.search?.queries.map((q) => q.query)).toEqual(["best climate tech podcasts", "climate podcast interviews"]);
    expect(await messages(run.id)).toContain("Round 2: 1 new search found 1 more source");
  });

  test("with no AI calls left, it neither asks the model nor searches", async () => {
    const { run, ctx, llm } = await plannedRun(0);
    const added = await moreLeads(web({}), "balanced")(ctx, 2);
    await ctx.dispose();

    expect(added).toEqual([]);
    expect(llm.calls).toHaveLength(0);
    expect(await messages(run.id)).toContain("Round 2: no AI calls left in this run's budget");
  });
});
