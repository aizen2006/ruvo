import type { SearchResultItem } from "./firecrawl";

/**
 * Client for SearXNG's JSON search (https://docs.searxng.org/dev/search_api.html): the
 * metasearch engine docker compose runs on this machine, so searching costs nothing.
 */

export interface SearxngClient {
  /** The first `limit` web results, shaped like Firecrawl's search so both providers are used alike. */
  search(query: string, opts: { limit: number; signal: AbortSignal }): Promise<{ web: SearchResultItem[]; creditsUsed: 0 }>;
}

const TIMEOUT_MS = 15_000;

export function createSearxng(baseUrl: string): SearxngClient {
  const endpoint = `${baseUrl.replace(/\/$/, "")}/search`;

  return {
    async search(query, { limit, signal }) {
      let res: Response;
      try {
        res = await fetch(`${endpoint}?${new URLSearchParams({ q: query, format: "json" })}`, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
        });
      } catch (err) {
        if (signal.aborted) throw err;
        throw new Error(`SearXNG at ${baseUrl} is unreachable (${(err as Error).message}); start it with docker compose up -d`);
      }
      if (!res.ok) throw new Error(`SearXNG responded ${res.status}${res.status === 403 ? "; its settings.yml must allow the json format" : ""}`);

      const { results, unresponsive_engines: failed } = (await res.json()) as {
        results: Array<{ url: string; title?: string; content?: string }>;
        unresponsive_engines: Array<[engine: string, error: string]>;
      };
      // Nothing found because the engines refused (a CAPTCHA, too many requests) is a failure, not an answer.
      if (!results.length && failed.length) throw new Error(`SearXNG found nothing: ${failed.map(([engine, error]) => `${engine} (${error})`).join(", ")}`);
      return { web: results.slice(0, limit).map((r) => ({ url: r.url, title: r.title ?? "", description: r.content ?? "" })), creditsUsed: 0 };
    },
  };
}
