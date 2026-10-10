import { beforeEach, describe, expect, test } from "bun:test";
import { asc } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { createBudget, createMetrics } from "../src/core/run";
import { db } from "../src/db/client";
import { searchCalls } from "../src/db/schema";
import { createSearchRunner, type SearchProvider } from "../src/search/cache";
import { createEngineSearch, ENGINE_GAP_MS, parseBing, parseBrave, parseDuckDuckGo, unwrapLink, type ReadResultsPage } from "../src/search/engines";
import { resetDb } from "./helpers/db";

/** Result pages captured from the engines, trimmed to their first results (DuckDuckGo's bot check is its lite page's). */
const page = (name: string) => readFileSync(new URL(`./fixtures/html/search-${name}.html`, import.meta.url), "utf8");
const never = new AbortController().signal;

describe("result page parsers", () => {
  test("DuckDuckGo: titles, snippets and the pages behind its redirect links", () => {
    const hits = parseDuckDuckGo(page("duckduckgo"));
    expect(hits).toHaveLength(4);
    expect(hits[0]).toEqual({
      url: "https://www.phrases.org.uk/meanings/beauty-is-in-the-eye-of-the-beholder.html",
      title: "Beauty is in the eye of the beholder - Phrasefinder",
      description: expect.stringMatching(/^What's the origin of the phrase 'Beauty is in the eye of the beholder'\?/),
    });
    expect(hits.map((h) => new URL(h.url).hostname)).not.toContain("duckduckgo.com");
  });

  test("DuckDuckGo's ads are skipped", () => {
    const ad = `<div id="links"><div class="result result--ad"><a class="result__a" href="https://duckduckgo.com/y.js?ad_domain=shop.example">Buy</a></div>
      <div class="result"><a class="result__a" href="https://site.example/a">A</a><a class="result__snippet">about a</a></div></div>`;
    expect(parseDuckDuckGo(ad)).toEqual([{ url: "https://site.example/a", title: "A", description: "about a" }]);
  });

  test("Bing: titles, snippets and the pages behind its ck/a links", () => {
    const hits = parseBing(page("bing"));
    expect(hits).toHaveLength(4);
    expect(hits[0]).toEqual({
      url: "https://support.microsoft.com/en-us/windows/how-to-get-help-in-windows-711b6492-0435-0038-8706-7c6b0feb200a",
      title: "How to get help in Windows - Microsoft Support",
      description: expect.stringMatching(/^Search for help on the taskbar/),
    });
    expect(hits.every((h) => !h.url.includes("bing.com"))).toBe(true);
  });

  test("Brave: titles, snippets and links", () => {
    const hits = parseBrave(page("brave"));
    expect(hits).toHaveLength(4);
    expect(hits[0]).toEqual({
      url: "https://earth.org/best-environmental-climate-podcasts/",
      title: "25 Must-Listen Podcasts on Climate Change, Justice and Sustainability | Earth.Org",
      description: expect.stringContaining("1. Going Wild; 2. Climate Rising"),
    });
  });

  test("a bot check page has no results", () => {
    expect(parseDuckDuckGo(page("duckduckgo-bot-check"))).toEqual([]);
  });
});

describe("redirect links", () => {
  test("DuckDuckGo's /l/?uddg= and Bing's ck/a?…&u=a1… lead to the page", () => {
    expect(unwrapLink("//duckduckgo.com/l/?uddg=https%3A%2F%2Fsite.example%2Fa%3Fb%3D1&rut=abc")).toBe("https://site.example/a?b=1");
    const encoded = Buffer.from("https://site.example/página?x=1").toString("base64url");
    expect(unwrapLink(`https://www.bing.com/ck/a?!&&p=abc&u=a1${encoded}&ntb=1`)).toBe("https://site.example/p%C3%A1gina?x=1");
  });

  test("other web links stay as they are; anything else is no result", () => {
    expect(unwrapLink("https://site.example/a")).toBe("https://site.example/a");
    expect(unwrapLink("/settings")).toBeNull();
    expect(unwrapLink("javascript:void(0)")).toBeNull();
    expect(unwrapLink("//duckduckgo.com/l/?uddg=javascript%3Aalert(1)")).toBeNull();
  });
});

describe("engine search", () => {
  /** A fake fetch service: each engine's host answers with `pages[host]` (a function of the engine used), and every read is logged. */
  function service(pages: Record<string, (via: string) => { body: string; challenge?: boolean } | Error>) {
    const reads: Array<{ host: string; via: string; at: number }> = [];
    const read: ReadResultsPage = async (url, via) => {
      const host = new URL(url).hostname;
      reads.push({ host, via, at: Date.now() });
      const answer = pages[host]?.(via) ?? new Error(`HTTP 404 from ${url}`);
      if (answer instanceof Error) throw answer;
      return answer;
    };
    return { read, reads };
  }
  const results = (name: string) => () => ({ body: page(name) });
  const brave = `<div class="snippet" data-type="web"><a href="https://www.phrases.org.uk/meanings/beauty-is-in-the-eye-of-the-beholder.html"><div class="title">Again</div></a></div>
    <div class="snippet" data-type="web"><a href="https://brave-only.example/"><div class="title">Only on Brave</div></a></div>`;

  test("asks the engines in turn and merges their results by URL in engine order", async () => {
    const { read, reads } = service({ "html.duckduckgo.com": results("duckduckgo"), "www.bing.com": results("bing"), "search.brave.com": () => ({ body: brave }) });
    const { web, creditsUsed } = await createEngineSearch(read).search("q", { limit: 20, signal: never });
    expect(creditsUsed).toBe(0);
    expect(web.map((h) => h.url)).toEqual([
      ...parseDuckDuckGo(page("duckduckgo")).map((h) => h.url),
      ...parseBing(page("bing")).map((h) => h.url),
      "https://brave-only.example/",
    ]);
    expect(reads.map((r) => r.host)).toEqual(["html.duckduckgo.com", "www.bing.com", "search.brave.com"]);
  });

  test("stops asking once it has enough results", async () => {
    const { read, reads } = service({ "html.duckduckgo.com": results("duckduckgo"), "www.bing.com": results("bing") });
    expect((await createEngineSearch(read).search("q", { limit: 3, signal: never })).web).toHaveLength(3);
    expect(reads.map((r) => r.host)).toEqual(["html.duckduckgo.com"]);
  });

  test("meets a bot check with the stealth browser, whether the service or the engine's own page shows it", async () => {
    const { read, reads } = service({
      "html.duckduckgo.com": (via) => ({ body: page(via === "http" ? "duckduckgo-bot-check" : "duckduckgo") }),
      "www.bing.com": (via) => (via === "http" ? { body: "", challenge: true } : { body: page("bing") }),
    });
    expect((await createEngineSearch(read).search("q", { limit: 8, signal: never })).web).toHaveLength(8);
    expect(reads.map((r) => `${r.host} ${r.via}`)).toEqual(["html.duckduckgo.com http", "html.duckduckgo.com stealth", "www.bing.com http", "www.bing.com stealth"]);
  });

  test("an engine that fails is passed over; nothing found because they all failed is an error naming them", async () => {
    const blocked = () => ({ body: page("duckduckgo-bot-check") });
    const { read } = service({ "html.duckduckgo.com": blocked, "www.bing.com": () => new Error("HTTP 503 from bing") });
    await expect(createEngineSearch(read).search("q", { limit: 5, signal: never })).rejects.toThrow(
      "The search engines found nothing: duckduckgo (still shows a bot check), bing (HTTP 503 from bing), brave (HTTP 404 from https://search.brave.com/search?q=q)",
    );
    const { read: partly } = service({ "html.duckduckgo.com": blocked, "search.brave.com": () => ({ body: brave }) });
    expect((await createEngineSearch(partly).search("q", { limit: 5, signal: never })).web).toHaveLength(2);
  });

  test("live queries to one engine start apart", async () => {
    const { read, reads } = service({ "html.duckduckgo.com": results("duckduckgo") });
    const engines = createEngineSearch(read);
    await Promise.all([engines.search("a", { limit: 1, signal: never }), engines.search("b", { limit: 1, signal: never })]);
    expect(reads).toHaveLength(2);
    expect(reads[1]!.at - reads[0]!.at).toBeGreaterThanOrEqual(ENGINE_GAP_MS - 5);
  });
});

describe("search runner with the engines", () => {
  const hits = (name: string) => [{ url: `https://${name}.example/`, title: name, description: "d" }];
  const provider = (web: ReturnType<typeof hits> | Error, credits = 0) => {
    const fake = {
      calls: 0,
      async search() {
        fake.calls++;
        if (web instanceof Error) throw web;
        return { web, creditsUsed: credits };
      },
    } satisfies SearchProvider & { calls: number };
    return fake;
  };
  const scope = () => ({
    signal: never,
    budget: createBudget({ maxPages: 0, maxBrowserPages: 0, maxLlmCalls: 0, maxSearches: 5, maxDurationMs: 60_000, maxRecords: 1 }),
    metrics: createMetrics(),
  });
  const runId = crypto.randomUUID();

  beforeEach(resetDb);

  test("the engines answer after SearXNG and before Firecrawl, and their results are cached as the engines'", async () => {
    const engines = provider(hits("engines"));
    const firecrawl = provider(hits("firecrawl"), 2);
    const runner = createSearchRunner({ searxng: provider(new Error("SearXNG is down")), engines, firecrawl, usdPerCredit: 0.002, cacheMode: "ttl" });
    expect(await runner.run("q", { limit: 10, runId, scope: scope() })).toEqual({ hits: hits("engines"), cached: false, costUsd: 0 });
    expect(firecrawl.calls).toBe(0);

    // Without SearXNG, the engines are asked first; the repeated search replays their results.
    const replay = await createSearchRunner({ engines, firecrawl, usdPerCredit: 0.002, cacheMode: "ttl" }).run("q", { limit: 10, runId, scope: scope() });
    expect(replay).toEqual({ hits: hits("engines"), cached: true, costUsd: 0 });
    expect(engines.calls).toBe(1);
    const rows = await db.select().from(searchCalls).orderBy(asc(searchCalls.createdAt));
    expect(rows.map((r) => [r.provider, r.cached, r.error])).toEqual([
      ["searxng", false, "SearXNG is down"],
      ["engines", false, null],
      ["engines", true, null],
    ]);
  });

  test("Firecrawl answers when the engines find nothing", async () => {
    const firecrawl = provider(hits("firecrawl"), 1);
    const runner = createSearchRunner({ engines: provider([]), firecrawl, usdPerCredit: 0.002, cacheMode: "ttl" });
    expect(await runner.run("q", { limit: 10, runId, scope: scope() })).toMatchObject({ hits: hits("firecrawl"), costUsd: 0.002 });
  });
});
