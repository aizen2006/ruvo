import { readFileSync } from "node:fs";
import type { Fetcher, FetchResult, FetchScope } from "../../src/fetch/fetcher";
import { createBudget } from "../../src/runs/budget";
import { createMetrics } from "../../src/runs/metrics";

/** Loads a response captured by scripts/capture-fixtures.ts. */
export function loadFixture<T = unknown>(name: string): { url: string; data: T } {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8"));
}

/**
 * A Fetcher serving captured fixtures. `routes` maps a URL substring to a fixture name,
 * e.g. { "greenhouse.io": "greenhouse" }; unmatched URLs fail like a 404.
 * Records every URL requested.
 */
export function fixtureFetcher(routes: Record<string, string> | string) {
  const table = typeof routes === "string" ? { "": routes } : routes;
  const pageIds = new Map<string, string>();
  const requested: string[] = [];

  const resolve = (url: string): FetchResult => {
    requested.push(url);
    const entry = Object.entries(table).find(([fragment]) => url.includes(fragment));
    if (!entry) throw Object.assign(new Error(`HTTP 404 from ${url}`), { kind: "http_status" });
    const name = entry[1];
    if (!pageIds.has(name)) pageIds.set(name, crypto.randomUUID());
    return {
      pageId: pageIds.get(name)!,
      url,
      finalUrl: url,
      status: 200,
      via: "http",
      fromCache: false,
      contentType: "application/json",
      body: JSON.stringify(loadFixture(name).data),
    };
  };

  const fetcher: Fetcher = {
    async fetch(_scope, req) {
      return resolve(req.url);
    },
    async json<T>(_scope: FetchScope, url: string) {
      const page = resolve(url);
      return { data: JSON.parse(page.body) as T, page };
    },
  };
  return { fetcher, requested };
}

export const testScope = (): FetchScope => ({
  signal: new AbortController().signal,
  budget: createBudget({ maxPages: 100, maxBrowserPages: 5, maxLlmCalls: 10, maxDurationMs: 60_000, maxRecords: 500 }),
  metrics: createMetrics(),
});
