import { beforeEach, describe, expect, test } from "bun:test";
import type { DatasetContract, RecipeDef } from "@repo/contracts";
import { readFileSync } from "node:fs";
import { htmlList } from "../src/adapters/htmlList";
import type { Fetcher, FetchResult } from "../src/fetch/fetcher";
import { DEMO_CONTRACT } from "../src/plan/demoContract";
import { createBudget } from "../src/runs/budget";
import { createMetrics } from "../src/runs/metrics";
import type { RunContext } from "../src/runs/runContext";
import { resetDb } from "./helpers/db";
import { fakeLlm } from "./helpers/fakeLlm";

beforeEach(resetDb);

const BOARD = "https://apply.workable.com/huggingface/";
const rendered = readFileSync(new URL("./fixtures/html/workable-rendered.html", import.meta.url), "utf8");

/** Serves the rendered board as if it had been escalated to the browser. */
const boardFetcher: Fetcher = {
  async fetch(_scope, req): Promise<FetchResult> {
    return {
      pageId: "00000000-0000-0000-0000-000000000001",
      url: req.url,
      finalUrl: req.url,
      status: 200,
      via: "browser",
      fromCache: false,
      contentType: "text/html",
      body: rendered,
      escalation: { reason: "only 0 characters of text", textLength: 0 },
    };
  },
  json: () => Promise.reject(new Error("not used")),
};

const recipe: RecipeDef = {
  itemSelector: 'li[data-ui="job"]',
  fields: [
    { name: "title", selector: '[data-ui="job-title"]', attr: "text", transform: "trim" },
    { name: "url", selector: "a", attr: "href", transform: "absolute_url" },
    { name: "remote", selector: '[data-ui="job-workplace"]', attr: "text", transform: "trim" },
    // Empty for remote roles on this board, which acceptance tolerates for non-identifying fields.
    { name: "location", selector: '[data-ui="job-location"]', attr: "text", transform: "trim" },
  ],
};

function run(llm: ReturnType<typeof fakeLlm>, contract: DatasetContract = DEMO_CONTRACT) {
  const events: Array<{ type: string; message: string }> = [];
  const ctx = {
    runId: crypto.randomUUID(),
    signal: new AbortController().signal,
    contract,
    budget: createBudget({ maxPages: 5, maxBrowserPages: 5, maxLlmCalls: 5, maxDurationMs: 60_000, maxRecords: 100 }),
    metrics: createMetrics(),
    llm,
    emit: (e: { type: string; message: string }) => events.push(e),
  } as unknown as RunContext;
  return { ctx, events };
}

describe("html_list adapter", () => {
  test("discovers a recipe on first use, then replays it without the LLM", async () => {
    const example = {
      fields: [
        { name: "title", quote: "Wild Card" },
        { name: "url", quote: "/huggingface/j/0BD8C06DB3/" },
        { name: "location", quote: "United States" },
        { name: "remote", quote: "Remote" },
      ],
    };
    const llm = fakeLlm({ example_record: example });
    const first = run(llm);
    const items = await htmlList.collect({ fetcher: boardFetcher, scope: first.ctx, run: first.ctx }, { url: BOARD, company: "Hugging Face", tags: ["ai_lab"] });

    expect(items).toHaveLength(8);
    expect(first.events.map((e) => e.type)).toEqual(["fetch.escalated", "recipe.discovered"]);
    expect(llm.calls).toHaveLength(1);

    const [item] = items;
    expect(item!.fields.title?.evidence).toMatchObject({ method: "DOM", locator: { kind: "css" } });
    expect(item!.fields.remote).toMatchObject({ value: "remote", evidence: { snippet: "Remote" } });
    expect(item!.fields.company).toMatchObject({ value: "Hugging Face", evidence: { method: "DERIVED" } });
    expect(item!.meta.companyTags).toEqual(["ai_lab"]);

    const second = run(llm);
    await htmlList.collect({ fetcher: boardFetcher, scope: second.ctx, run: second.ctx }, { url: BOARD, company: "Hugging Face", tags: [] });
    expect(second.events.map((e) => e.type)).toContain("recipe.replayed");
    expect(llm.calls).toHaveLength(1);
  });

  test("fails clearly when no reliable recipe can be found", async () => {
    const { ctx } = run(fakeLlm({ example_record: { fields: [] }, recipe: { ...recipe, itemSelector: "li.nope" } }));
    await expect(htmlList.collect({ fetcher: boardFetcher, scope: ctx, run: ctx }, { url: BOARD, tags: [] })).rejects.toThrow(
      "Could not find a reliable way to read apply.workable.com",
    );
  });
});
