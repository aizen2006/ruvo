import { readFileSync } from "node:fs";
import type { Fetcher, FetchResult, FetchScope } from "../../src/fetch/fetcher";
import { createBudget } from "../../src/runs/budget";
import { createMetrics } from "../../src/runs/metrics";

/** Loads a response captured by scripts/capture-fixtures.ts. */
export function loadFixture<T = unknown>(name: string): { url: string; data: T } {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8"));
}

/** A Fetcher that serves one fixture for every JSON request and records the URLs asked for. */
export function fixtureFetcher(name: string) {
  const { data } = loadFixture(name);
  const requested: string[] = [];
  const page = (url: string): FetchResult => ({
    pageId: `page-${name}`,
    url,
    finalUrl: url,
    status: 200,
    via: "http",
    fromCache: false,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
  const fetcher: Fetcher = {
    async fetch(_scope, req) {
      requested.push(req.url);
      return page(req.url);
    },
    async json<T>(_scope: FetchScope, url: string) {
      requested.push(url);
      return { data: data as T, page: page(url) };
    },
  };
  return { fetcher, requested };
}

export const testScope = (): FetchScope => ({
  signal: new AbortController().signal,
  budget: createBudget({ maxPages: 100, maxBrowserPages: 5, maxLlmCalls: 10, maxDurationMs: 60_000, maxRecords: 500 }),
  metrics: createMetrics(),
});
