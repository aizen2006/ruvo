import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { createHostLimiter } from "../fetch/hostLimiter";
import type { SearchProvider } from "./cache";
import type { SearchResultItem } from "./firecrawl";

/**
 * Web search without SearXNG: DuckDuckGo's, Bing's and Brave's result pages, read through RUVO's fetch service (so
 * its egress guard applies) and parsed here. Like SearXNG, it reads the engines' own pages, outside the page fetcher's
 * robots.txt policy, so it keeps polite: one query asks the engines in turn, only until it has enough results, and live
 * queries to one engine start at least ENGINE_GAP_MS apart.
 */

/** Reads a results page through the fetch service; `challenge` marks a bot check, which the stealth browser meets next. */
export type ReadResultsPage = (url: string, via: "http" | "stealth", signal: AbortSignal) => Promise<{ body: string; challenge?: boolean }>;

interface Engine {
  name: string;
  url: (query: string) => string;
  parse: (html: string) => SearchResultItem[];
  /** The engine's own bot check, which it serves as an ordinary page (DuckDuckGo's comes with HTTP 202). */
  blocked?: (html: string) => boolean;
}

export const ENGINE_GAP_MS = 1_000;

const ENGINES: Engine[] = [
  {
    name: "duckduckgo",
    url: (q) => `https://html.duckduckgo.com/html/?${new URLSearchParams({ q })}`,
    parse: parseDuckDuckGo,
    blocked: (html) => html.includes("anomaly-modal"),
  },
  { name: "bing", url: (q) => `https://www.bing.com/search?${new URLSearchParams({ q })}`, parse: parseBing },
  { name: "brave", url: (q) => `https://search.brave.com/search?${new URLSearchParams({ q })}`, parse: parseBrave },
];

export function createEngineSearch(read: ReadResultsPage): SearchProvider {
  // One live query per engine at a time, spaced apart, across every run in this process.
  const limiter = createHostLimiter({ maxConcurrent: 1, minDelayMs: ENGINE_GAP_MS });

  /** One engine's results; past a bot check with the stealth browser, as the page fetcher goes. */
  async function ask(engine: Engine, query: string, signal: AbortSignal) {
    const url = engine.url(query);
    let page = await read(url, "http", signal);
    if (page.challenge || engine.blocked?.(page.body)) page = await read(url, "stealth", signal);
    if (engine.blocked?.(page.body)) throw new Error("still shows a bot check");
    return engine.parse(page.body);
  }

  return {
    async search(query, { limit, signal }) {
      // Merged by URL in engine order: an engine adds only results the ones before it didn't find.
      const found = new Map<string, SearchResultItem>();
      const failed: string[] = [];
      for (const engine of ENGINES) {
        if (found.size >= limit) break;
        try {
          for (const hit of await limiter.run(engine.name, 0, () => ask(engine, query, signal), signal)) if (!found.has(hit.url)) found.set(hit.url, hit);
        } catch (err) {
          if (signal.aborted) throw err;
          failed.push(`${engine.name} (${(err as Error).message})`);
        }
      }
      // Nothing found because the engines refused (a bot check, an error) is a failure, not an answer, as with SearXNG.
      if (!found.size && failed.length) throw new Error(`The search engines found nothing: ${failed.join(", ")}`);
      return { web: [...found.values()].slice(0, limit), creditsUsed: 0 };
    },
  };
}

/** DuckDuckGo's HTML results (html.duckduckgo.com), without its ads. */
export function parseDuckDuckGo(html: string): SearchResultItem[] {
  const $ = cheerio.load(html);
  return $("#links .result:not(.result--ad)")
    .map((_, el) => hit($(el).find("a.result__a"), $(el).find(".result__snippet")))
    .get();
}

export function parseBing(html: string): SearchResultItem[] {
  const $ = cheerio.load(html);
  return $("#b_results > li.b_algo")
    .map((_, el) => hit($(el).find("h2 a").first(), $(el).find(".b_caption p").first()))
    .get();
}

export function parseBrave(html: string): SearchResultItem[] {
  const $ = cheerio.load(html);
  return $('.snippet[data-type="web"]')
    .map((_, el) => hit($(el).find("a[href]").first(), $(el).find(".generic-snippet .content").first(), $(el).find(".title").first()))
    .get();
}

/** A result from its link, snippet and (when not the link's text) title; none when the link leads nowhere RUVO can read. */
function hit(link: cheerio.Cheerio<Element>, snippet: cheerio.Cheerio<Element>, title = link): SearchResultItem | undefined {
  const url = unwrapLink(link.attr("href") ?? "");
  const text = (el: cheerio.Cheerio<Element>) => el.text().replace(/\s+/g, " ").trim();
  return url ? { url, title: text(title), description: text(snippet) } : undefined;
}

/**
 * The page an engine's result link leads to: DuckDuckGo's /l/?uddg=… and Bing's /ck/a?…&u=a1<base64url> redirects
 * unwrapped, any other web link as it is; null for anything else.
 */
export function unwrapLink(href: string): string | null {
  const url = URL.parse(href, "https://engine.invalid");
  if (!url) return null;
  const uddg = url.searchParams.get("uddg");
  if (url.hostname.endsWith("duckduckgo.com") && url.pathname === "/l/" && uddg) return unwrapLink(uddg);
  const u = url.searchParams.get("u");
  if (url.hostname.endsWith("bing.com") && url.pathname === "/ck/a" && u?.startsWith("a1")) return unwrapLink(Buffer.from(u.slice(2), "base64url").toString("utf8"));
  return (url.protocol === "https:" || url.protocol === "http:") && url.hostname !== "engine.invalid" ? url.href : null;
}
