import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type { DatasetContract, PlanDraft } from "@repo/contracts";
import { htmlList } from "../src/adapters/htmlList";
import { normalizeContract } from "../src/compile/normalize";
import { attachWorkflow, saveContract, saveWorkflow } from "../src/db/repos/workflows";
import type { Fetcher, FetchResult } from "../src/fetch/fetcher";
import { DEMO_CONTRACT } from "../src/plan/demoContract";
import { discoverSources } from "../src/plan/discovery";
import { compileIr } from "../src/plan/irCompiler";
import { planForContract } from "../src/plan/planner";
import type { RegistryCompany } from "../src/plan/registry";
import { createBudget } from "../src/runs/budget";
import { createMetrics } from "../src/runs/metrics";
import type { RunContext } from "../src/runs/runContext";
import { insertRun, resetDb } from "./helpers/db";
import { fakeLlm } from "./helpers/fakeLlm";
import { startTestServer } from "./helpers/http";

/**
 * Bring-your-own-URL: requests for data other than jobs are collected from the list pages
 * the user links, with the contract's own (custom) fields.
 */

beforeEach(resetDb);

const PAGE = "https://example.com/front";
const STORIES: DatasetContract = {
  ...DEMO_CONTRACT,
  entity: "other",
  entityDescription: "A story on a news front page",
  title: "Front page stories",
  fields: [
    { name: "title", catalogKey: "title", type: "string", required: true, description: "Headline" },
    { name: "link", catalogKey: "url", type: "url", required: true, description: "Story link" },
    { name: "points", catalogKey: "custom", type: "number", required: false, description: "Votes" },
  ],
  criteria: [],
  assumptions: [],
  dedupKeys: [["link"]],
  sourceHints: { companies: [], excludeCompanies: [], companyTags: ["ai_lab"], urls: [PAGE], searchQueries: [], includeCommunityBoards: true },
};
const registry: RegistryCompany[] = [
  { id: crypto.randomUUID(), name: "Anthropic", ats: "greenhouse", slug: "anthropic", tags: ["ai_lab"], boardUrl: null, origin: "curated", jobCount: 10, verifiedAt: null },
];
const caps = { maxPages: 10, maxBrowserPages: 2, maxLlmCalls: 20, maxDurationMs: 60_000, maxRecords: 100 };

describe("sources for non-job data", () => {
  test("only linked pages; never the job registry or community boards", () => {
    expect(discoverSources(STORIES, registry).candidates.map((c) => c.ref)).toEqual([`html_list:${PAGE}`]);
    const unlinked = { ...STORIES, sourceHints: { ...STORIES.sourceHints, urls: [] } };
    expect(discoverSources(unlinked, registry).candidates).toEqual([]);
  });

  test("linked URLs are cleaned up", () => {
    const { contract, warnings } = normalizeContract(
      { ...STORIES, sourceHints: { ...STORIES.sourceHints, urls: ["example.com/a", "https://example.com/a", "ftp://x.org/f", "not a url"] } },
      "stories",
    );
    expect(contract.sourceHints.urls).toEqual(["https://example.com/a"]);
    expect(warnings.filter((w) => w.startsWith("Ignored"))).toHaveLength(2);
  });
});

describe("planning linked pages", () => {
  test("the LLM budget covers recipe discovery even if the planner set none", () => {
    const [candidate] = discoverSources(STORIES, registry).candidates;
    const draft: PlanDraft = {
      sources: [{ ref: candidate!.ref, include: true, reason: "linked", titleKeywords: [], fetchDetails: false, maxItems: 30 }],
      fieldStrategies: [],
      llmBudget: 0,
      rationale: "",
    };
    const ir = compileIr(STORIES, draft, [candidate!], { caps, provenance: { plannedBy: "llm", model: null, reusedFrom: null, parentVersion: null } });
    expect(ir.budgets.maxLlmCalls).toBe(2);
    expect(ir.provenance.warnings).toContain("Raised the LLM budget from 0 to 2 calls to cover page recipes and judged criteria");
  });

  test("with nothing to plan, the planner is not called", async () => {
    const llm = fakeLlm();
    const { ir } = await planForContract(llm, { ...STORIES, sourceHints: { ...STORIES.sourceHints, urls: [] } }, [], caps);
    expect(llm.calls).toHaveLength(0);
    expect(ir.sources).toEqual([]);
    expect(ir.provenance.warnings[0]).toBe("No sources to collect from yet");
  });
});

describe("starting a run without sources", () => {
  const api = startTestServer();
  afterAll(() => api.close());

  test("is refused with a clear next step", async () => {
    const run = await insertRun({ status: "awaiting_approval" });
    const { ir } = await planForContract(fakeLlm(), STORIES, [], caps);
    const contractRow = await saveContract({ requestId: run.requestId, contract: STORIES, editedBy: "llm" });
    await attachWorkflow(run.id, (await saveWorkflow({ contractId: contractRow.id, ir })).id);

    const { status, body } = await api.post(`/api/runs/${run.id}/start`);
    expect(status).toBe(409);
    expect(body.error).toContain("Add the address of a page");
  });
});

describe("reading a linked page", () => {
  const html = `<html><head><title>News</title></head><body><h1>Top stories</h1><table>
    ${[1, 2, 3, 4].map((i) => `<tr class="story"><td><a class="headline" href="/s/${i}">Story ${i}</a></td><td class="score">${i},20${i} points</td></tr>`).join("")}
  </table></body></html>`;
  const fetcher: Fetcher = {
    fetch: async (_s, req): Promise<FetchResult> => ({ pageId: null as unknown as string, url: req.url, finalUrl: req.url, status: 200, via: "http", fromCache: false, contentType: "text/html", body: html, escalation: null }),
    json: () => Promise.reject(new Error("not used")),
  };

  test("reads custom fields and normalizes numbers", async () => {
    const llm = fakeLlm({
      recipe: {
        itemSelector: "tr.story",
        fields: [
          { name: "title", selector: "a.headline", attr: "text", transform: "trim" },
          { name: "link", selector: "a.headline", attr: "href", transform: "absolute_url" },
          { name: "points", selector: ".score", attr: "text", transform: "trim" },
        ],
      },
    });
    const ctx = {
      runId: crypto.randomUUID(),
      signal: new AbortController().signal,
      contract: STORIES,
      budget: createBudget({ ...caps, maxRecords: 100 }),
      metrics: createMetrics(),
      llm,
      repairs: [],
      emit: () => {},
    } as unknown as RunContext;

    const items = await htmlList.collect({ fetcher, scope: ctx, run: ctx }, { url: PAGE, tags: [] });
    expect(items).toHaveLength(4);
    expect(items[0]!.fields).toMatchObject({
      title: { value: "Story 1" },
      // Items are keyed by catalog key; the contract's field name ("link") applies when stored.
      url: { value: "https://example.com/s/1" },
      points: { value: "1201", evidence: { method: "DOM", snippet: "1,201 points" } },
    });
  });
});
