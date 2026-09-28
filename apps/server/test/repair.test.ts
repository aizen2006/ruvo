import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type { RecipeDef } from "@repo/contracts";
import { htmlList } from "../src/adapters/htmlList";
import { getRunWorkflow, attachWorkflow, saveContract, saveWorkflow } from "../src/db/repos/workflows";
import { createDecider } from "../src/decide/decider";
import type { SystemOneClient } from "../src/decide/systemOneClient";
import type { Fetcher, FetchResult } from "../src/fetch/fetcher";
import { careersPage } from "../src/fixtures/careersSite";
import { toPageState } from "../src/page/pageState";
import { DEMO_CONTRACT } from "../src/plan/demoContract";
import { buildTemplateIr } from "../src/plan/templates";
import { acceptanceFor } from "../src/recipes/discover";
import { listRecipes, saveRecipe, urlPatternOf } from "../src/recipes/store";
import { relaxRecipe, stripGeneratedHashes } from "../src/repair/relax";
import { createBudget } from "../src/runs/budget";
import { createMetrics } from "../src/runs/metrics";
import { recordRepairs } from "../src/runs/pipeline";
import type { RunContext } from "../src/runs/runContext";
import { insertRun, resetDb } from "./helpers/db";
import { fakeLlm } from "./helpers/fakeLlm";
import { startTestServer } from "./helpers/http";
import { driftRecipe } from "../src/repair/drift";

beforeEach(resetDb);

const URL_ = "http://localhost:3000/fixtures/careers";
const LIST_FIELDS = DEMO_CONTRACT.fields.filter((f) => ["title", "url", "location"].includes(f.catalogKey));

const V1_RECIPE: RecipeDef = {
  itemSelector: "div.job-card",
  fields: [
    { name: "title", selector: "h3.job-title", attr: "text", transform: "trim" },
    { name: "url", selector: "h3.job-title a", attr: "href", transform: "absolute_url" },
    { name: "location", selector: ".job-location", attr: "text", transform: "trim" },
  ],
};
const V2_RECIPE: RecipeDef = {
  itemSelector: "article.job-listing",
  fields: [
    { name: "title", selector: ".listing-name", attr: "text", transform: "trim" },
    { name: "url", selector: "a.listing-link", attr: "href", transform: "absolute_url" },
    { name: "location", selector: ".meta-where", attr: "text", transform: "trim" },
  ],
};

const saveV1 = (def: RecipeDef = V1_RECIPE) =>
  saveRecipe({ ...urlPatternOf(URL_), pageType: "job_list", parentId: null, origin: "llm_discovery", def, acceptance: acceptanceFor(LIST_FIELDS) });

/** Serves one page per transport, as the fetcher would after (or without) escalation. */
function pages(byVia: { http: string; browser?: string }): Fetcher {
  return {
    async fetch(_scope, req): Promise<FetchResult> {
      const via = req.mode === "browser" ? "browser" : "http";
      return { pageId: null as unknown as string, url: req.url, finalUrl: req.url, status: 200, via, fromCache: false, contentType: "text/html", body: byVia[via] ?? byVia.http, escalation: null };
    },
    json: () => Promise.reject(new Error("not used")),
  };
}

/** A decision provider that always answers `choice`. */
const choosing = (choice: string) =>
  createDecider({
    provider: { available: () => true, ask: async () => ({ model: "jev-1.13.0", answers: { q: { type: "choice", choice, probabilities: { [choice]: 0.95 } } } }) } satisfies SystemOneClient,
    mode: "active",
  });

function run(llm = fakeLlm(), decider = choosing("CHANGE_SELECTOR")) {
  const events: Array<{ type: string; message: string }> = [];
  const ctx = {
    runId: crypto.randomUUID(),
    signal: new AbortController().signal,
    contract: DEMO_CONTRACT,
    budget: createBudget({ maxPages: 5, maxBrowserPages: 5, maxLlmCalls: 5, maxDurationMs: 60_000, maxRecords: 100 }),
    metrics: createMetrics(),
    llm,
    decider,
    repairs: [],
    emit: (e: { type: string; message: string }) => events.push(e),
  } as unknown as RunContext;
  return { ctx, events };
}

const collect = (ctx: RunContext, fetcher: Fetcher) => htmlList.collect({ fetcher, scope: ctx, run: ctx }, { url: URL_, company: "Northwind Labs", tags: [] });

describe("local selector repair", () => {
  test("strips generated hashes but keeps their readable prefix", () => {
    expect(stripGeneratedHashes("li.card--x1Y2z > span.title__a1B2c")).toBe('li[class*="card--"] > span[class*="title__"]');
    expect(stripGeneratedHashes("div.job-card h3.css-1x2y3z")).toBe("div.job-card h3.css-1x2y3z");
  });

  test("recovers from a rebuild that changed class hashes", () => {
    const html = careersPage(1).replace(/class="job-card"/g, 'class="card--q9R8s"').replace(/class="job-title"/g, 'class="title--z7Y6x"');
    const drifted: RecipeDef = { ...V1_RECIPE, itemSelector: "div.card--a1B2c", fields: [{ ...V1_RECIPE.fields[0]!, selector: "h3.title--b3C4d" }, V1_RECIPE.fields[1]!, V1_RECIPE.fields[2]!] };
    const fixed = relaxRecipe({ html, url: URL_, state: toPageState(html, URL_), def: drifted, acceptance: acceptanceFor(LIST_FIELDS), roles: { title: "title", url: "url", location: "location" } });
    expect(fixed?.result.itemCount).toBe(8);
    expect(fixed?.result.fill.title).toBe(1);
  });

  test("gives up on a redesign it cannot read (the location moved)", () => {
    const html = careersPage(2);
    const fixed = relaxRecipe({ html, url: URL_, state: toPageState(html, URL_), def: V1_RECIPE, acceptance: acceptanceFor(LIST_FIELDS), roles: { title: "title", url: "url", location: "location" } });
    expect(fixed).toBeNull();
  });
});

describe("recipe repair in html_list", () => {
  test("a renamed item wrapper is fixed locally: recipe v2, no LLM", async () => {
    await saveV1({ ...V1_RECIPE, itemSelector: "div.job-card.renamed" });
    const llm = fakeLlm();
    const { ctx, events } = run(llm);
    const items = await collect(ctx, pages({ http: careersPage(1) }));

    expect(items).toHaveLength(8);
    expect(llm.calls).toHaveLength(0);
    expect(events.map((e) => e.type)).toEqual(["recipe.failed", "repair.decided", "recipe.repaired"]);
    expect(ctx.repairs).toMatchObject([{ fromVersion: 1, toVersion: 2, origin: "local_repair" }]);
    const [latest, old] = await listRecipes();
    expect(latest).toMatchObject({ version: 2, status: "active", origin: "local_repair", parentId: old!.id });
    expect(old!.status).toBe("retired");
  });

  test("a site redesign is rediscovered with the LLM after the local fix fails", async () => {
    await saveV1();
    const llm = fakeLlm({ recipe: V2_RECIPE });
    const { ctx, events } = run(llm);
    const items = await collect(ctx, pages({ http: careersPage(2) }));

    expect(items).toHaveLength(8);
    expect(items[0]!.fields.location?.value).toBe("Remote (EU)");
    expect(events.map((e) => e.type)).toEqual(["recipe.failed", "repair.decided", "repair.local_failed", "recipe.repaired"]);
    expect(ctx.repairs).toMatchObject([{ toVersion: 2, origin: "llm_repair" }]);
    // The LLM was told what broke.
    expect(JSON.parse(llm.calls[0]!.input.find((m) => m.role === "user")!.content).problemWithPreviousAttempt).toContain("SELECTOR_MISS");
  });

  test("an empty HTTP shell switches to the browser and keeps the recipe", async () => {
    await saveV1();
    const { ctx, events } = run(fakeLlm(), choosing("STOP"));
    const shell = `<html><body><div id="root"></div></body></html>`;
    const items = await collect(ctx, pages({ http: shell, browser: careersPage(1) }));

    expect(items).toHaveLength(8);
    expect(events.find((e) => e.type === "repair.decided")?.message).toContain("EMPTY_RENDER → SWITCH_TO_BROWSER (decided by rules)");
    expect(ctx.repairs).toHaveLength(0);
    expect(await listRecipes()).toHaveLength(1);
  });

  test("stops when the policy says so", async () => {
    await saveV1();
    const { ctx } = run(fakeLlm(), choosing("STOP"));
    await expect(collect(ctx, pages({ http: careersPage(2) }))).rejects.toThrow("Could not repair the recipe for localhost:3000");
  });
});

describe("repaired workflow version", () => {
  test("repairs become workflow v+1, planned by repair, and the run moves onto it", async () => {
    const runRow = await insertRun({ status: "running" });
    const ir = buildTemplateIr(DEMO_CONTRACT, [], {
      budgets: { maxPages: 1, maxBrowserPages: 0, maxLlmCalls: 0, maxDurationMs: 60_000, maxRecords: 10 },
      maxItemsPerSource: 10,
    });
    const contractRow = await saveContract({ requestId: runRow.requestId, contract: DEMO_CONTRACT, editedBy: "template" });
    await attachWorkflow(runRow.id, (await saveWorkflow({ contractId: contractRow.id, ir })).id);

    const events: Array<{ type: string }> = [];
    await recordRepairs({
      runId: runRow.id,
      repairs: [{ host: "localhost:3000", fromVersion: 1, toVersion: 2, origin: "local_repair", failure: "SELECTOR_MISS: 0 items" }],
      emit: (e) => void events.push(e),
    });

    const wf = await getRunWorkflow(runRow.id);
    expect(wf.version).toBe(2);
    expect(wf.ir.provenance).toMatchObject({ plannedBy: "repair", parentVersion: 1 });
    expect(wf.ir.provenance.repairs?.at(-1)).toContain("Repaired recipe for localhost:3000: v1 → v2 (local selector fix)");
    expect(wf.versions.map((v) => v.plannedBy)).toEqual(["repair", "template"]);
    expect(events.map((e) => e.type)).toEqual(["workflow.repaired"]);
  });
});

describe("simulated drift", () => {
  const api = startTestServer();
  afterAll(() => api.close());

  test("minor drift only renames the item wrapper; major drift stales every selector", () => {
    expect(driftRecipe(V1_RECIPE, "minor")).toEqual({ ...V1_RECIPE, itemSelector: "div.job-card.ruvo-drift" });
    const major = driftRecipe(V1_RECIPE, "major");
    expect(major.fields.map((f) => f.selector)).toEqual(["h3.job-title.ruvo-drift", "h3.job-title a.ruvo-drift", ".job-location.ruvo-drift"]);
  });

  test("records a simulated_drift version, and the next read repairs it", async () => {
    const v1 = await saveV1();
    const { status, body } = await api.post(`/api/recipes/${v1.id}/simulate-drift`, { mode: "minor" });
    expect(status).toBe(201);
    expect(body).toMatchObject({ version: 2, status: "active", origin: "simulated_drift", parentId: v1.id });

    const listed = await api.get("/api/recipes?host=localhost:3000");
    expect(listed.body.map((r: { version: number; status: string }) => [r.version, r.status])).toEqual([
      [2, "active"],
      [1, "retired"],
    ]);

    const { ctx } = run();
    expect(await collect(ctx, pages({ http: careersPage(1) }))).toHaveLength(8);
    const [v3] = await listRecipes();
    expect(v3).toMatchObject({ version: 3, origin: "local_repair", parentId: body.id });
  });

  test("unknown recipes are 404", async () => {
    expect((await api.post(`/api/recipes/${crypto.randomUUID()}/simulate-drift`, { mode: "major" })).status).toBe(404);
  });
});

describe("linked pages", () => {
  test("the company comes from the page when the registry does not supply it", async () => {
    const llm = fakeLlm({ recipe: V1_RECIPE });
    const { ctx } = run(llm);
    const [item] = await htmlList.collect({ fetcher: pages({ http: careersPage(1) }), scope: ctx, run: ctx }, { url: URL_, tags: [] });
    expect(item!.fields.company).toMatchObject({ value: "Northwind Labs", evidence: { method: "DERIVED", snippet: "<h1>Northwind Labs</h1>" } });
  });
});

describe("recipes recorded for other columns", () => {
  test("are not replayed when they miss a field this request requires", async () => {
    // Recorded for a request that only wanted titles and links.
    const narrow = await saveV1({ ...V1_RECIPE, fields: V1_RECIPE.fields.filter((f) => f.name !== "location") });
    const llm = fakeLlm({ recipe: V1_RECIPE });
    const { ctx, events } = run(llm);
    const items = await collect(ctx, pages({ http: careersPage(1) }));

    expect(events.map((e) => e.type)).toEqual(["recipe.extended", "recipe.discovered"]);
    expect(items[0]!.fields.location?.value).toBe("Remote (EU)");
    const [latest] = await listRecipes();
    expect(latest).toMatchObject({ version: 2, parentId: narrow.id });
  });
});
