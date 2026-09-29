import { beforeEach, describe, expect, test } from "bun:test";
import type { DatasetContract, RecipeDef } from "@repo/contracts";
import { htmlList } from "../src/adapters/htmlList";
import { FetchError } from "../src/fetch/errors";
import type { Fetcher, FetchResult } from "../src/fetch/fetcher";
import { nextPageUrl } from "../src/page/pagination";
import { acceptanceFor } from "../src/recipes/discover";
import { saveRecipe, urlPatternOf } from "../src/recipes/store";
import { createBudget } from "../src/runs/budget";
import { createMetrics } from "../src/runs/metrics";
import type { RunContext } from "../src/runs/runContext";
import { resetDb } from "./helpers/db";
import { fakeLlm } from "./helpers/fakeLlm";

const URL_ = "https://directory.example.com/berlin";

describe("nextPageUrl", () => {
  test("prefers rel=next", () => {
    const html = `<head><link rel="next" href="/berlin?page=2"></head><body><nav><a href="/berlin?page=9">Next</a></nav></body>`;
    expect(nextPageUrl(html, URL_)).toBe("https://directory.example.com/berlin?page=2");
  });

  test("finds a next link inside the pagination, not elsewhere", () => {
    const html = `<body><a href="/news">Next event »</a><div class="pagination"><a href="/berlin?p=1">«</a><a href="/berlin?p=3">Next »</a></div></body>`;
    expect(nextPageUrl(html, `${URL_}?p=2`)).toBe("https://directory.example.com/berlin?p=3");
  });

  test("falls back to the link numbered one past the current page", () => {
    const html = `<body><ul role="navigation"><li><a href="/berlin/page/1">1</a></li><li class="active">2</li><li><a href="/berlin/page/3">3</a></li></ul></body>`;
    expect(nextPageUrl(html, `${URL_}/page/2`)).toBe("https://directory.example.com/berlin/page/3");
  });

  test("null on the last page, or when the only candidate is this page", () => {
    expect(nextPageUrl(`<body><nav><span class="current">3</span></nav></body>`, URL_)).toBeNull();
    expect(nextPageUrl(`<head><link rel="next" href="/berlin#top"></head>`, URL_)).toBeNull();
  });
});

describe("html_list pagination", () => {
  beforeEach(resetDb);

  const listPage = (page: number, names: string[], next: number | null) => `<html><body><h1>Companies</h1><ul class="companies">
    ${names.map((n) => `<li class="company"><a class="name" href="/companies/${n.toLowerCase()}">${n}</a></li>`).join("")}
    </ul><nav>${next ? `<a href="/berlin?page=${next}">Next</a>` : ""}<span class="current">${page}</span></nav></body></html>`;
  const PAGES: Record<string, string> = {
    [URL_]: listPage(1, ["Ledgerly", "Shipmate", "Quotient"], 2),
    [`${URL_}?page=2`]: listPage(2, ["Formwork", "Peerlane", "Tallyho"], 3),
    // Page 3 repeats page 2 (a site that ignores the page number): nothing new, so paging stops.
    [`${URL_}?page=3`]: listPage(3, ["Formwork", "Peerlane", "Tallyho"], 4),
  };
  const fetcherFor = (pages: Record<string, string>, requested: string[]): Fetcher => ({
    async fetch(_scope, req): Promise<FetchResult> {
      requested.push(req.url);
      const body = pages[req.url];
      if (!body) throw new FetchError("robots_disallowed", `robots.txt disallows ${req.url}`, { url: req.url });
      return { pageId: crypto.randomUUID(), url: req.url, finalUrl: req.url, status: 200, via: "http", fromCache: false, contentType: "text/html", body, escalation: null };
    },
    json: () => Promise.reject(new Error("not used")),
  });

  const CONTRACT = {
    entity: "other",
    fields: [
      { name: "name", catalogKey: "title", type: "string", required: true, description: "Company name" },
      { name: "website", catalogKey: "url", type: "url", required: true, description: "Profile link" },
    ],
  } as unknown as DatasetContract;
  const RECIPE: RecipeDef = {
    itemSelector: "li.company",
    fields: [
      { name: "name", selector: "a.name", attr: "text", transform: "trim" },
      { name: "website", selector: "a.name", attr: "href", transform: "absolute_url" },
    ],
  };

  async function collect(pages: Record<string, string>, maxListPages: number) {
    await saveRecipe({ ...urlPatternOf(URL_), pageType: "job_list", parentId: null, origin: "llm_discovery", def: RECIPE, acceptance: acceptanceFor(CONTRACT.fields) });
    const events: Array<{ type: string; message: string }> = [];
    const requested: string[] = [];
    const ctx = {
      runId: crypto.randomUUID(),
      signal: new AbortController().signal,
      contract: CONTRACT,
      budget: createBudget({ maxPages: 10, maxBrowserPages: 0, maxLlmCalls: 0, maxDurationMs: 60_000, maxRecords: 100 }),
      metrics: createMetrics(),
      llm: fakeLlm(),
      repairs: [],
      maxListPages,
      emit: (e: { type: string; message: string }) => events.push(e),
    } as unknown as RunContext;
    const items = await htmlList.collect({ fetcher: fetcherFor(pages, requested), scope: ctx, run: ctx }, { url: URL_, tags: [] });
    return { items, events, requested };
  }

  test("follows next links with the recorded recipe and stops when a page adds nothing new", async () => {
    const { items, events, requested } = await collect(PAGES, 5);
    expect(items.map((i) => i.fields.title?.value)).toEqual(["Ledgerly", "Shipmate", "Quotient", "Formwork", "Peerlane", "Tallyho"]);
    expect(items[3]!.fields.title?.evidence.sourceUrl).toBe(`${URL_}?page=2`);
    expect(requested).toEqual([URL_, `${URL_}?page=2`, `${URL_}?page=3`]);
    expect(events.at(-1)?.message).toBe("directory.example.com: read 2 list pages, 6 items");
  });

  test("reads only the first page when the mode allows one", async () => {
    const { items, requested } = await collect(PAGES, 1);
    expect(items).toHaveLength(3);
    expect(requested).toEqual([URL_]);
  });

  test("stops, keeping what it has, when the fetcher refuses the next page", async () => {
    const { items, events } = await collect({ [URL_]: PAGES[URL_]! }, 5);
    expect(items).toHaveLength(3);
    expect(events.at(-1)).toMatchObject({ type: "pagination.stopped" });
    expect(events.at(-1)?.message).toContain("robots.txt does not allow");
  });
});
