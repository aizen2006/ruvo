import { beforeEach, describe, expect, test } from "bun:test";
import type { FieldSpec, RecipeDef } from "@repo/contracts";
import { readFileSync } from "node:fs";
import { toPageState } from "../src/page/pageState";
import { acceptanceFor, discoverRecipe } from "../src/recipes/discover";
import { acceptanceFailure, replayRecipe } from "../src/recipes/replay";
import { findActiveRecipe, listRecipes, urlPatternOf } from "../src/recipes/store";
import { createBudget } from "../src/runs/budget";
import { createMetrics } from "../src/runs/metrics";
import { resetDb } from "./helpers/db";
import { fakeLlm } from "./helpers/fakeLlm";

beforeEach(resetDb);

const URL_ = "https://apply.workable.com/huggingface/";
const html = readFileSync(new URL("./fixtures/html/workable-rendered.html", import.meta.url), "utf8");
/** The same page after a redesign renamed its data-ui hooks. */
const drifted = html.replaceAll('data-ui="job"', 'data-ui="posting"').replaceAll('data-ui="job-title"', 'data-ui="posting-title"');

const workableRecipe: RecipeDef = {
  itemSelector: 'li[data-ui="job"]',
  fields: [
    { name: "title", selector: '[data-ui="job-title"]', attr: "text", transform: "trim" },
    { name: "url", selector: "a", attr: "href", transform: "absolute_url" },
    { name: "remote", selector: '[data-ui="job-workplace"]', attr: "text", transform: "trim" },
    { name: "department", selector: '[data-ui="job-department"]', attr: "text", transform: "trim" },
  ],
};

const fields: FieldSpec[] = [
  { name: "title", catalogKey: "title", type: "string", required: true, description: "Job title" },
  { name: "url", catalogKey: "url", type: "url", required: true, description: "Posting link" },
  { name: "remote", catalogKey: "remote", type: "string", required: false, description: "Arrangement" },
];

describe("replayRecipe", () => {
  test("extracts one row per item with absolute links", () => {
    const result = replayRecipe(html, URL_, workableRecipe);
    expect(result.itemCount).toBe(8);
    expect(result.rows[0]).toMatchObject({ remote: "Remote", department: "Product" });
    expect(result.rows[0]!.title).toContain("Engineer");
    expect(result.rows[0]!.url).toMatch(/^https:\/\/apply\.workable\.com\/huggingface\/j\/[A-Z0-9]+\/$/);
    expect(result.fill).toMatchObject({ title: 1, url: 1 });
  });

  test("classifies a redesigned page as a selector miss", () => {
    const result = replayRecipe(drifted, URL_, workableRecipe);
    expect(acceptanceFailure(result, acceptanceFor(fields))).toMatchObject({ kind: "SELECTOR_MISS" });
  });

  test("classifies missing required fields as a partial fill", () => {
    const withoutTitles = { ...workableRecipe, fields: [{ ...workableRecipe.fields[0]!, selector: "h6" }, ...workableRecipe.fields.slice(1)] };
    expect(acceptanceFailure(replayRecipe(html, URL_, withoutTitles), acceptanceFor(fields))).toMatchObject({ kind: "PARTIAL_FILL" });
  });

  test("an invalid selector matches nothing instead of throwing", () => {
    expect(replayRecipe(html, URL_, { ...workableRecipe, itemSelector: "li[[" }).itemCount).toBe(0);
  });
});

describe("urlPatternOf", () => {
  test("generalizes path segments so a recipe serves every board on the host", () => {
    expect(urlPatternOf(URL_)).toEqual({ host: "apply.workable.com", urlPattern: "apply.workable.com/*" });
    expect(urlPatternOf("https://apply.workable.com/other-company/")).toEqual(urlPatternOf(URL_));
  });
});

describe("discoverRecipe", () => {
  const ctx = (llm: ReturnType<typeof fakeLlm>) => ({
    runId: crypto.randomUUID(),
    llm,
    signal: new AbortController().signal,
    budget: createBudget({ maxPages: 1, maxBrowserPages: 1, maxLlmCalls: 10, maxDurationMs: 60_000, maxRecords: 1 }),
    metrics: createMetrics(),
  });
  const page = { html, url: URL_, state: toPageState(html, URL_) };

  test("retries with the failure report and saves only a recipe that passes", async () => {
    let attempt = 0;
    const llm = fakeLlm({
      recipe: ({ input }: { input: Array<{ content: string }> }) => {
        attempt++;
        const request = JSON.parse(input.at(-1)!.content) as { problemWithPreviousAttempt: string | null };
        if (attempt === 1) return { ...workableRecipe, itemSelector: "li.styles--nope" };
        expect(request.problemWithPreviousAttempt).toContain("SELECTOR_MISS");
        return workableRecipe;
      },
    });

    const discovered = await discoverRecipe(ctx(llm), page, fields);
    expect(discovered).toMatchObject({ attempts: 2, recipe: { version: 1, origin: "llm_discovery", status: "active" } });
    expect(discovered!.result.itemCount).toBe(8);
    expect((await findActiveRecipe("https://apply.workable.com/another-board/"))?.id).toBe(discovered!.recipe.id);
  });

  test("gives up after two failing proposals and saves nothing", async () => {
    const llm = fakeLlm({ recipe: { ...workableRecipe, itemSelector: "li.nope" } });
    expect(await discoverRecipe(ctx(llm), page, fields)).toBeNull();
    expect(await listRecipes()).toEqual([]);
  });

  test("a new version retires the previous one", async () => {
    const llm = fakeLlm({ recipe: workableRecipe });
    const first = await discoverRecipe(ctx(llm), page, fields);
    const second = await discoverRecipe(ctx(llm), page, fields, { origin: "llm_repair", parent: first!.recipe });
    expect(second!.recipe).toMatchObject({ version: 2, parentId: first!.recipe.id, origin: "llm_repair" });
    expect((await listRecipes()).map((r) => [r.version, r.status])).toEqual([
      [2, "active"],
      [1, "retired"],
    ]);
  });
});
