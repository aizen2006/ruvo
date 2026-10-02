import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { EvidenceMethod, RecipeDef } from "@repo/contracts";
import * as cheerio from "cheerio";
import { tmpdir } from "node:os";
import { env } from "../src/config/env";
import { db } from "../src/db/client";
import { evidence, pages, records } from "../src/db/schema";
import { createDecider } from "../src/decide/decider";
import type { SystemOneClient } from "../src/decide/systemOneClient";
import { createScraplingClient, type Relocated } from "../src/fetch/scrapling";
import { careersPage } from "../src/fixtures/careersSite";
import { DEMO_CONTRACT } from "../src/plan/demoContract";
import { acceptanceFor } from "../src/recipes/discover";
import { acceptanceFailure, replayRecipe } from "../src/recipes/replay";
import { listRecipes, saveRecipe, urlPatternOf } from "../src/recipes/store";
import { relocateRecipe } from "../src/repair/relocate";
import { repairRecipe, type RepairInput } from "../src/repair/repairRecipe";
import { createBudget } from "../src/runs/budget";
import { createMetrics } from "../src/runs/metrics";
import type { RunContext } from "../src/runs/runContext";
import { insertRun, resetDb } from "./helpers/db";
import { fakeLlm } from "./helpers/fakeLlm";

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
/** What the LLM rediscovers for the redesign, when repair gets that far. */
const V2_RECIPE: RecipeDef = {
  itemSelector: "article.job-listing",
  fields: [
    { name: "title", selector: ".listing-name", attr: "text", transform: "trim" },
    { name: "url", selector: "a.listing-link", attr: "href", transform: "absolute_url" },
    { name: "location", selector: ".meta-where", attr: "text", transform: "trim" },
  ],
};

// The service's answers for V1_RECIPE, as infra/scrapling/server.py gives them for the demo site's pages.
const ARTICLE = "html > body:nth-of-type(1) > main:nth-of-type(1) > section:nth-of-type(1) > article:nth-of-type(1)";
const TO_V2: Relocated = {
  item: ARTICLE,
  fields: { title: `${ARTICLE} > a:nth-of-type(1)`, url: `${ARTICLE} > a:nth-of-type(1)`, location: `${ARTICLE} > ul:nth-of-type(1) > li:nth-of-type(1)` },
};
/** The v1 page with the job cards renamed `job-tile`. */
const TILES = careersPage(1).replace(/class="job-card"/g, 'class="job-tile"');
const TILE = "html > body:nth-of-type(1) > main:nth-of-type(1) > section:nth-of-type(1) > div:nth-of-type(1)";

/** A stand-in for the service's POST /relocate: answers `reply` (an HTTP status is a failure) and keeps each request. */
let reply: Relocated | number;
type RelocateRequest = RecipeDef & { oldHtml: string; newHtml: string };
let requests: Array<{ path: string; contentType: string | null; body: RelocateRequest }>;
beforeEach(() => {
  reply = TO_V2;
  requests = [];
});
const service = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    requests.push({ path: new URL(req.url).pathname, contentType: req.headers.get("content-type"), body: (await req.json()) as RelocateRequest });
    return typeof reply === "number" ? Response.json({ error: "bad_request", message: "no" }, { status: reply }) : Response.json(reply);
  },
});
const serviceUrl = `http://127.0.0.1:${service.port}`;

// relocate.ts makes its client from SCRAPLING_URL when it loads, so calls to that address are sent on to the fake.
let forward: { mockRestore(): void };
beforeAll(() => {
  if (!env.SCRAPLING_URL) throw new Error("these tests need SCRAPLING_URL set (to any address; its calls go to a fake)");
  const configured = new URL(env.SCRAPLING_URL).origin;
  const realFetch = globalThis.fetch;
  forward = spyOn(globalThis, "fetch").mockImplementation(((input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    return realFetch(url.origin === configured ? new URL(url.pathname, serviceUrl) : url, init);
  }) as unknown as typeof fetch);
});
afterAll(() => {
  forward.mockRestore();
  service.stop(true);
});

const signal = () => new AbortController().signal;
const serialized = (html: string) => cheerio.load(html).html();
const saveV1 = () => saveRecipe({ ...urlPatternOf(URL_), pageType: "job_list", parentId: null, origin: "llm_discovery", def: V1_RECIPE, acceptance: acceptanceFor(LIST_FIELDS) });

/** Stores a copy of the careers page that a record cites with `method` evidence (null: no record cites it). */
async function storePage(body: string, { method = "DOM", minutesAgo = 0 }: { method?: EvidenceMethod | null; minutesAgo?: number } = {}) {
  const [page] = await db
    .insert(pages)
    .values({ url: URL_, finalUrl: URL_, host: "localhost:3000", via: "http", status: 200, contentHash: crypto.randomUUID(), body, bytes: body.length, fetchedAt: new Date(Date.now() - minutesAgo * 60_000) })
    .returning();
  if (!method) return;
  const run = await insertRun();
  const [record] = await db.insert(records).values({ runId: run.id, sourceId: "northwind", itemKey: crypto.randomUUID(), data: {}, status: "valid" }).returning();
  await db.insert(evidence).values({
    recordId: record!.id,
    field: "title",
    value: "Account Executive",
    method,
    sourceUrl: URL_,
    pageId: page!.id,
    snippet: "Account Executive",
    locator: { kind: "css", value: "h3.job-title" },
    verified: true,
    confidence: 0.9,
  });
}

describe("Scrapling client: relocate", () => {
  const client = createScraplingClient(serviceUrl);
  const req = { ...V1_RECIPE, oldHtml: "<p>old</p>", newHtml: "<p>new</p>" };

  test("posts the recipe and both pages to /relocate and returns where the item and fields are", async () => {
    expect(await client.relocate(req, signal())).toEqual(TO_V2);
    expect(requests).toEqual([{ path: "/relocate", contentType: "application/json", body: req }]);
  });

  test("a failed call is an error with the service's status", async () => {
    reply = 400;
    await expect(client.relocate(req, signal())).rejects.toThrow("RUVO's fetch service could not relocate a recipe (HTTP 400)");
  });

  test("an unreachable service rejects", async () => {
    const down = Bun.serve({ port: 0, fetch: () => new Response() });
    const url = `http://127.0.0.1:${down.port}`;
    await down.stop(true);
    await expect(createScraplingClient(url).relocate(req, signal())).rejects.toThrow();
  });
});

describe("relocateRecipe", () => {
  test("re-finds the item and fields on a redesigned page from the last page the recipe read", async () => {
    await storePage(careersPage(1));
    const recipe = await saveV1();
    const fix = await relocateRecipe({ html: careersPage(2), url: URL_ }, recipe, signal());

    expect(requests.map((r) => r.body)).toEqual([{ ...V1_RECIPE, oldHtml: serialized(careersPage(1)), newHtml: serialized(careersPage(2)) }]);
    expect(fix?.def).toEqual({
      itemSelector: "article.job-listing",
      fields: [
        { ...V1_RECIPE.fields[0]!, selector: "a.listing-link" },
        { ...V1_RECIPE.fields[1]!, selector: "a.listing-link" },
        { ...V1_RECIPE.fields[2]!, selector: "li.meta-where" },
      ],
    });
    expect(fix?.result.itemCount).toBe(8);
    expect(fix?.result.rows[0]).toEqual({ title: "Senior Backend Engineer, Inference API", url: "http://localhost:3000/fixtures/careers/jobs/be-1", location: "Remote (EU)" });
  });

  test("the old page is the newest copy records cite as DOM evidence", async () => {
    const cited = careersPage(1).replace("Site version 1", "Site version 1, as last cited");
    await storePage(careersPage(1), { minutesAgo: 30 });
    await storePage(cited, { minutesAgo: 20 });
    await storePage(careersPage(1).replace("Site version 1", "never cited"), { method: null, minutesAgo: 10 });
    await storePage(careersPage(1).replace("Site version 1", "cited by the LLM"), { method: "LLM" });

    await relocateRecipe({ html: careersPage(2), url: URL_ }, await saveV1(), signal());
    expect(requests.map((r) => r.body.oldHtml)).toEqual([serialized(cited)]);
  });

  test("without a cited copy the recipe still reads, the service is not asked", async () => {
    const recipe = await saveV1();
    expect(await relocateRecipe({ html: careersPage(2), url: URL_ }, recipe, signal())).toBeNull();

    await storePage(careersPage(1), { method: null });
    await storePage(careersPage(1), { method: "LLM" });
    await storePage(careersPage(2));
    expect(await relocateRecipe({ html: careersPage(2), url: URL_ }, recipe, signal())).toBeNull();
    expect(requests).toHaveLength(0);
  });

  test("a field it cannot place, or places outside the item, keeps its old selector", async () => {
    await storePage(careersPage(1));
    reply = { item: TILE, fields: { title: `${TILE} > h3:nth-of-type(1)`, url: null, location: "html > body:nth-of-type(1) > header:nth-of-type(1) > h1:nth-of-type(1)" } };
    const fix = await relocateRecipe({ html: TILES, url: URL_ }, await saveV1(), signal());

    expect(fix?.def).toEqual({ itemSelector: "div.job-tile", fields: V1_RECIPE.fields });
    expect(fix?.result.rows[1]).toMatchObject({ title: "AI Infrastructure Engineer", location: "Berlin" });
  });

  test("relocated selectors that fail acceptance are no fix", async () => {
    await storePage(careersPage(1));
    reply = { item: ARTICLE, fields: { title: TO_V2.fields.title!, url: null, location: null } };
    expect(await relocateRecipe({ html: careersPage(2), url: URL_ }, await saveV1(), signal())).toBeNull();
    expect(requests).toHaveLength(1);
  });

  test("a failing service is no fix", async () => {
    await storePage(careersPage(1));
    reply = 500;
    expect(await relocateRecipe({ html: careersPage(2), url: URL_ }, await saveV1(), signal())).toBeNull();
    expect(requests).toHaveLength(1);
  });

  test("a blank SCRAPLING_URL turns it off", async () => {
    await storePage(careersPage(1));
    const recipe = await saveV1();
    // relocate.ts reads SCRAPLING_URL when it loads, so it is loaded afresh in a process with the address blank.
    const script = `
      const { relocateRecipe } = await import(${JSON.stringify(Bun.fileURLToPath(new URL("../src/repair/relocate.ts", import.meta.url)))});
      const { careersPage } = await import(${JSON.stringify(Bun.fileURLToPath(new URL("../src/fixtures/careersSite.ts", import.meta.url)))});
      const fix = await relocateRecipe({ html: careersPage(2), url: ${JSON.stringify(URL_)} }, ${JSON.stringify(recipe)}, new AbortController().signal);
      console.log(JSON.stringify(fix));
      process.exit(0);`;
    // Run outside apps/server, so no .env file sets the address again.
    const child = Bun.spawn([process.execPath, "-e", script], { cwd: tmpdir(), env: { ...process.env, SCRAPLING_URL: "" }, stdout: "pipe" });
    expect(await child.exited).toBe(0);
    expect((await new Response(child.stdout).text()).trim()).toBe("null");
  });
});

describe("repairRecipe with Scrapling relocation", () => {
  /** A decision provider that always answers `choice`. */
  const choosing = (choice: string) =>
    createDecider({
      provider: { available: () => true, ask: async () => ({ model: "jev-1.13.0", answers: { q: { type: "choice", choice, probabilities: { [choice]: 0.95 } } } }) } satisfies SystemOneClient,
      mode: "active",
    });

  /** Repairs recipe v1 against `html`, with the LLM rediscovering V2_RECIPE if asked. */
  async function repair(html: string, { decide = "CHANGE_SELECTOR", via = "http" }: { decide?: string; via?: "http" | "browser" } = {}) {
    const llm = fakeLlm({ recipe: V2_RECIPE });
    const events: Array<{ type: string; message: string }> = [];
    const run = {
      runId: crypto.randomUUID(),
      signal: signal(),
      contract: DEMO_CONTRACT,
      budget: createBudget({ maxPages: 5, maxBrowserPages: 5, maxLlmCalls: 5, maxDurationMs: 60_000, maxRecords: 100 }),
      metrics: createMetrics(),
      llm,
      decider: choosing(decide),
      repairs: [],
      emit: (e: { type: string; message: string }) => events.push(e),
    } as unknown as RunContext;
    const recipe = await saveV1();
    const result = replayRecipe(html, URL_, recipe.def);
    const repaired = await repairRecipe(run, {
      page: { html, url: URL_, finalUrl: URL_, pageId: null, via },
      recipe,
      result,
      failure: acceptanceFailure(result, recipe.acceptance) as RepairInput["failure"],
      fields: LIST_FIELDS,
      refetch: () => Promise.reject(new Error("not refetched in these tests")),
    });
    return { repaired, events, llm, parent: recipe };
  }

  test("a redesign the local fix cannot read is re-found with Scrapling and saved as v2, no LLM", async () => {
    await storePage(careersPage(1));
    const { repaired, events, llm, parent } = await repair(careersPage(2));

    expect(events.map((e) => e.type)).toEqual(["repair.decided", "recipe.repaired"]);
    expect(events[1]!.message).toBe("localhost:3000: recipe v1 → v2, re-found its fields with Scrapling from the last page it read, no LLM needed");
    expect(llm.calls).toHaveLength(0);
    expect(repaired?.result.itemCount).toBe(8);
    const [latest] = await listRecipes();
    expect(latest).toMatchObject({ version: 2, origin: "local_repair", parentId: parent.id, def: { itemSelector: "article.job-listing" } });
    expect(repaired?.recipe.id).toBe(latest!.id);
  });

  test("relocated selectors that fail acceptance fall through to LLM rediscovery", async () => {
    await storePage(careersPage(1));
    reply = { item: ARTICLE, fields: { title: TO_V2.fields.title!, url: null, location: null } };
    const { repaired, events } = await repair(careersPage(2));

    expect(requests).toHaveLength(1);
    expect(events.map((e) => e.type)).toEqual(["repair.decided", "repair.local_failed", "recipe.repaired"]);
    expect(repaired?.recipe).toMatchObject({ version: 2, origin: "llm_repair", def: V2_RECIPE });
  });

  test("with no stored page, or a failing service, the LLM rediscovers", async () => {
    const noPage = await repair(careersPage(2));
    expect(requests).toHaveLength(0);
    expect(noPage.repaired?.recipe.origin).toBe("llm_repair");

    await resetDb();
    await storePage(careersPage(1));
    reply = 500;
    const failing = await repair(careersPage(2));
    expect(requests).toHaveLength(1);
    expect(failing.repaired?.recipe.origin).toBe("llm_repair");
  });

  test("an escalated redesign tries relocation before the LLM", async () => {
    await storePage(careersPage(1));
    const { repaired, events, llm } = await repair(careersPage(2), { decide: "ESCALATE" });

    expect(events[0]!.message).toContain("SELECTOR_MISS → ESCALATE");
    expect(requests).toHaveLength(1);
    expect(llm.calls).toHaveLength(0);
    expect(repaired?.recipe.origin).toBe("local_repair");
  });

  test("an empty render escalates straight to the LLM", async () => {
    await storePage(careersPage(1));
    const { events, llm } = await repair(`<html><body><div id="root"></div></body></html>`, { via: "browser" });

    expect(events[0]!.message).toContain("EMPTY_RENDER → ESCALATE (decided by rules)");
    expect(requests).toHaveLength(0);
    expect(llm.calls.length).toBeGreaterThan(0);
  });
});
