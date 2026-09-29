import { beforeEach, describe, expect, test } from "bun:test";
import type { DatasetContract } from "@repo/contracts";
import { htmlRecord } from "../src/adapters/htmlRecord";
import type { Fetcher } from "../src/fetch/fetcher";
import { DEMO_CONTRACT } from "../src/plan/demoContract";
import { compileIr } from "../src/plan/irCompiler";
import { templateDraft } from "../src/plan/templates";
import { createBudget } from "../src/runs/budget";
import { createMetrics } from "../src/runs/metrics";
import type { RunContext } from "../src/runs/runContext";
import { resetDb } from "./helpers/db";
import { fakeLlm } from "./helpers/fakeLlm";

beforeEach(resetDb);

const PODCASTS: DatasetContract = {
  ...DEMO_CONTRACT,
  entity: "other",
  entityDescription: "A podcast about climate technology",
  fields: [
    { name: "name", catalogKey: "title", type: "string", required: true, description: "Podcast name" },
    { name: "url", catalogKey: "url", type: "url", required: true, description: "Podcast website" },
    { name: "host", catalogKey: "custom", type: "string", required: true, description: "Who hosts it" },
    { name: "episodes", catalogKey: "custom", type: "number", required: false, description: "Number of episodes" },
  ],
  criteria: [],
  dedupKeys: [["url"]],
};

const PAGE = "https://climatenow.example/about";

const pageFetcher = (body: string): Fetcher => ({
  fetch: async (_scope, req) => ({
    pageId: crypto.randomUUID(),
    url: req.url,
    finalUrl: req.url,
    status: 200,
    via: "http",
    fromCache: false,
    contentType: "text/html",
    body,
    escalation: null,
  }),
  json: () => Promise.reject(new Error("not used")),
});

function run(llm = fakeLlm()) {
  return {
    runId: crypto.randomUUID(),
    signal: new AbortController().signal,
    contract: PODCASTS,
    budget: createBudget({ maxPages: 5, maxBrowserPages: 0, maxLlmCalls: 5, maxDurationMs: 60_000, maxRecords: 10 }),
    metrics: createMetrics(),
    llm,
    emit: () => {},
  } as unknown as RunContext;
}

const collect = (body: string, ctx: RunContext) => htmlRecord.collect({ fetcher: pageFetcher(body), scope: ctx, run: ctx }, { url: PAGE });

describe("html_record adapter", () => {
  test("one page, one record: JSON-LD first, then quoted LLM values; the page is its own url", async () => {
    const body = `<html><head><script type="application/ld+json">${JSON.stringify({ "@type": "PodcastSeries", name: "Climate Now" })}</script></head>
      <body><nav>Home | Episodes</nav><main><p>Hosted by James Lawler.</p><p>Over 200 episodes so far.</p></main></body></html>`;
    const llm = fakeLlm({
      field_extraction: {
        fields: [
          { name: "host", value: "James Lawler", quote: "Hosted by James Lawler" },
          { name: "episodes", value: "250", quote: "250 episodes" },
        ],
      },
    });
    const [item, ...rest] = await collect(body, run(llm));

    expect(rest).toHaveLength(0);
    expect(item!.externalId).toBe(PAGE);
    expect(item!.fields.title).toMatchObject({ value: "Climate Now", evidence: { method: "JSON_LD" } });
    expect(item!.fields.host).toMatchObject({ value: "James Lawler", evidence: { method: "LLM", verified: true } });
    // The invented count has no quote on the page, so it is dropped.
    expect(item!.fields.episodes).toBeUndefined();
    expect(item!.fields.url).toMatchObject({ value: PAGE, evidence: { method: "DERIVED" } });
    // Only the fields JSON-LD missed went to the model, and page chrome was left out.
    const sent = JSON.parse(llm.calls[0]!.input.at(-1)!.content) as { fields: Array<{ name: string }>; text: string };
    expect(sent.fields.map((f) => f.name)).toEqual(["host", "episodes"]);
    expect(sent.text).not.toContain("Home | Episodes");
  });

  test("a page whose JSON-LD is an ItemList yields each listed record", async () => {
    const list = {
      "@type": "ItemList",
      itemListElement: [
        { "@type": "ListItem", position: 1, item: { "@type": "PodcastSeries", name: "Climate Now", url: "https://a.example" } },
        { "@type": "ListItem", position: 2, item: { "@type": "PodcastSeries", name: "My Climate Journey", url: "https://b.example" } },
      ],
    };
    const llm = fakeLlm();
    const items = await collect(`<script type="application/ld+json">${JSON.stringify(list)}</script>`, run(llm));
    expect(items.map((i) => [i.fields.title?.value, i.fields.url?.value])).toEqual([
      ["Climate Now", "https://a.example"],
      ["My Climate Journey", "https://b.example"],
    ]);
    expect(llm.calls).toHaveLength(0);
  });

  test("the IR reads every column from the page: no enrich step, custom fields stay required", () => {
    const candidate = { ref: `html_record:${PAGE}`, adapter: "html_record" as const, label: "climatenow.example/about", params: { url: PAGE }, tags: [], jobCount: null, reason: "test", origin: "search" as const };
    const ir = compileIr(PODCASTS, { ...templateDraft([candidate], 5), llmBudget: 0 }, [candidate], {
      caps: { maxPages: 10, maxBrowserPages: 0, maxLlmCalls: 10, maxDurationMs: 60_000, maxRecords: 10 },
      provenance: { plannedBy: "template", model: null, reusedFrom: null, parentVersion: null },
    });
    const steps = ir.sources[0]!.steps;
    expect(steps.map((s) => s.kind)).toEqual(["collect", "match", "validate", "store"]);
    expect(steps.find((s) => s.kind === "validate")).toMatchObject({ required: ["name", "url", "host"] });
    expect(ir.budgets.maxLlmCalls).toBeGreaterThanOrEqual(1);
  });
});
