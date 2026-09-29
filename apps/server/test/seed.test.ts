import { beforeEach, describe, expect, test } from "bun:test";
import type { FieldSpec } from "@repo/contracts";
import { readFileSync } from "node:fs";
import { fitText } from "../src/page/fitText";
import { toPageState } from "../src/page/pageState";
import { discoverRecipe } from "../src/recipes/discover";
import { replayRecipe } from "../src/recipes/replay";
import { recipeFromExample } from "../src/recipes/seed";
import { createBudget } from "../src/runs/budget";
import { createMetrics } from "../src/runs/metrics";
import { resetDb } from "./helpers/db";
import { fakeLlm } from "./helpers/fakeLlm";

const page = (name: string) => readFileSync(new URL(`./fixtures/html/${name}.html`, import.meta.url), "utf8");
const field = (name: string, catalogKey: FieldSpec["catalogKey"], type: FieldSpec["type"] = "string"): FieldSpec => ({ name, catalogKey, type, required: true, description: name });

const JOBS = { url: "https://apply.workable.com/huggingface/", html: page("workable-rendered") };
const JOB_FIELDS = [field("title", "title"), field("url", "url", "url"), field("remote", "remote")];
const JOB_EXAMPLE = [
  { name: "title", quote: "Senior Open-Source Python Engineer, ML Developer Tools - EMEA Remote" },
  { name: "url", quote: "/huggingface/j/DB4D7C0EC8/" },
  { name: "remote", quote: "Remote" },
];

describe("recipeFromExample", () => {
  test("a job board: data-ui hooks, an empty link beside the title", () => {
    const def = recipeFromExample(JOBS.html, JOBS.url, JOB_FIELDS, JOB_EXAMPLE)!;
    expect(def.itemSelector).toBe('li[data-ui="job"]');
    const result = replayRecipe(JOBS.html, JOBS.url, def);
    expect(result.itemCount).toBe(8);
    expect(result.fill).toEqual({ title: 1, url: 1, remote: 1 });
    expect(result.rows[1]).toMatchObject({ title: "Senior Open-Source Python Engineer, ML Developer Tools - US Remote", url: "https://apply.workable.com/huggingface/j/F88446C814/" });
  });

  test("a company directory: cards in rows, a featured card, the city repeated in filters", () => {
    const url = "https://directory.example.com/berlin";
    const html = page("company-directory");
    const fields = [field("name", "custom"), field("website", "url", "url"), field("city", "custom"), field("founders", "custom")];
    const def = recipeFromExample(html, url, fields, [
      { name: "name", quote: "Ledgerly" },
      { name: "website", quote: "/companies/ledgerly?ref=dir" },
      { name: "city", quote: "Berlin" },
      { name: "founders", quote: "Anna Weber, Tomasz Nowak" },
    ])!;
    expect(def.itemSelector).toBe("div.company-card");
    const result = replayRecipe(html, url, def);
    expect(result.itemCount).toBe(6);
    expect(result.fill).toEqual({ name: 1, website: 1, city: 1, founders: 1 });
    expect(result.rows.at(-1)).toEqual({ name: "Tallyho", website: "https://directory.example.com/companies/tallyho", city: "Berlin", founders: "Ben Hartmann" });
  });

  test("a table: rows under the header, cells told apart by position", () => {
    const url = "https://pods.example.org/climate";
    const html = page("podcast-table");
    const fields = [field("show", "title"), field("link", "url", "url"), field("host", "custom"), field("episodes", "custom", "number")];
    const def = recipeFromExample(html, url, fields, [
      { name: "show", quote: "Carbon Talk" },
      { name: "link", quote: "https://pods.example.org/shows/carbon-talk" },
      { name: "host", quote: "Priya Raman" },
      { name: "episodes", quote: "212" },
    ])!;
    const result = replayRecipe(html, url, def);
    expect(result.itemCount).toBe(5);
    expect(result.rows[2]).toEqual({ show: "The Heat Pump", link: "https://pods.example.org/shows/the-heat-pump", host: "Sara Lind", episodes: "97" });
  });

  test("quotes that are not on the page give no recipe", () => {
    expect(recipeFromExample(JOBS.html, JOBS.url, JOB_FIELDS, [{ name: "title", quote: "Chief Vibes Officer" }])).toBeNull();
  });
});

describe("fitText", () => {
  test("shows the records first, drops page chrome, and ranks other text by the request", () => {
    const view = fitText(page("company-directory"), "company office", 3000);
    expect(view.startsWith("## 6 similar items (div.row > div.col-4)")).toBe(true);
    expect(view).toContain('<a href="/companies/ledgerly?ref=dir"> Ledgerly');
    for (const chrome of ["Filter by city", "Munich", "Directory GmbH"]) expect(view).not.toContain(chrome);
    expect(view.indexOf("has an office in Berlin")).toBeLessThan(view.indexOf("<h1> B2B SaaS companies"));
  });
});

describe("seed-first discovery", () => {
  beforeEach(resetDb);

  const ctx = (llm: ReturnType<typeof fakeLlm>) => ({
    runId: crypto.randomUUID(),
    llm,
    signal: new AbortController().signal,
    budget: createBudget({ maxPages: 1, maxBrowserPages: 1, maxLlmCalls: 10, maxDurationMs: 60_000, maxRecords: 1 }),
    metrics: createMetrics(),
  });
  const input = { ...JOBS, state: toPageState(JOBS.html, JOBS.url) };

  test("records a recipe from one example record with a single LLM call on the pruned page view", async () => {
    const llm = fakeLlm({ example_record: { fields: JOB_EXAMPLE } });
    const discovered = await discoverRecipe(ctx(llm), input, JOB_FIELDS);

    expect(discovered).toMatchObject({ method: "seed", attempts: 1, recipe: { version: 1, def: { itemSelector: 'li[data-ui="job"]' } } });
    expect(llm.calls.map((c) => c.name)).toEqual(["example_record"]);
    const request = JSON.parse(llm.calls[0]!.input.find((m) => m.role === "user")!.content);
    expect(request.pageView).toBe(fitText(JOBS.html, "title title url url remote remote", 12_000));
  });

  test("falls back to the whole-recipe prompt when the example cannot be placed", async () => {
    const recipe = {
      itemSelector: 'li[data-ui="job"]',
      fields: [
        { name: "title", selector: '[data-ui="job-title"]', attr: "text", transform: "trim" },
        { name: "url", selector: "a", attr: "href", transform: "absolute_url" },
        { name: "remote", selector: '[data-ui="job-workplace"]', attr: "text", transform: "trim" },
      ],
    };
    const llm = fakeLlm({ example_record: { fields: [{ name: "title", quote: "Chief Vibes Officer" }] }, recipe });
    const discovered = await discoverRecipe(ctx(llm), input, JOB_FIELDS);

    expect(discovered).toMatchObject({ method: "prompt", attempts: 2 });
    expect(llm.calls.map((c) => c.name)).toEqual(["example_record", "recipe"]);
  });
});
