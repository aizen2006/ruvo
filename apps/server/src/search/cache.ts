import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { searchCalls } from "../db/schema";
import { sha256, stableStringify } from "../libs/hash";
import type { FetchScope } from "../fetch/fetcher";
import type { SearchResultItem } from "./firecrawl";

/**
 * Runs a web search through SearXNG, then Firecrawl when SearXNG fails or finds nothing, caching
 * results in `search_calls` so re-runs are free and reproducible (mirroring the LLM cache). Also
 * records which provider answered and what each live search cost.
 */

export interface CachedSearch {
  hits: SearchResultItem[];
  cached: boolean;
  costUsd: number;
}

export interface SearchRunner {
  /** Searches, drawing one unit from the run's `searches` budget for a live call (never for a cache hit). */
  run(query: string, opts: { limit: number; runId: string; scope: FetchScope }): Promise<CachedSearch | null>;
}

/** A web search provider: results in Firecrawl's shape, and the credits they cost. */
export interface SearchProvider {
  search(query: string, opts: { limit: number; signal: AbortSignal }): Promise<{ web: SearchResultItem[]; creditsUsed: number }>;
}

export interface SearchRunnerDeps {
  /** Asked first: free, on this machine. */
  searxng?: SearchProvider;
  /** The backup when SearXNG fails or finds nothing; it costs credits. */
  firecrawl?: SearchProvider;
  usdPerCredit: number;
  /** off replays cache only; on caches live calls; cache_only never calls out. Follows FETCH_CACHE_MODE. */
  cacheMode: "off" | "ttl" | "prefer_cache" | "cache_only";
}

export function createSearchRunner(deps: SearchRunnerDeps): SearchRunner {
  const { usdPerCredit, cacheMode } = deps;
  const providers = (["searxng", "firecrawl"] as const).flatMap((name) => {
    const provider = deps[name];
    return provider ? [{ name, provider }] : [];
  });

  return {
    async run(query, { limit, runId, scope }) {
      // Keyed by the search alone: a re-run replays the same results, whichever provider gave them.
      const inputHash = sha256(stableStringify({ query, limit }));

      if (cacheMode !== "off") {
        const hit = await findCached(inputHash);
        if (hit) {
          await log({ runId, provider: hit.provider, query, inputHash, hits: hit.hits, cached: true });
          return { hits: hit.hits, cached: true, costUsd: 0 };
        }
        if (cacheMode === "cache_only") return null;
      }

      // A live search spends from the run's budget; degrade quietly when it's used up.
      if (!scope.budget.take("searches")) return null;

      let costUsd = 0;
      const errors: unknown[] = [];
      for (const { name, provider } of providers) {
        try {
          const res = await provider.search(query, { limit, signal: scope.signal });
          const cost = res.creditsUsed * usdPerCredit;
          costUsd += cost;
          await log({ runId, provider: name, query, inputHash, hits: res.web, credits: res.creditsUsed, costUsd: cost });
          if (res.web.length) return { hits: res.web, cached: false, costUsd };
        } catch (err) {
          if (scope.signal.aborted) throw err;
          await log({ runId, provider: name, query, inputHash, error: err instanceof Error ? err.message : String(err) }).catch(() => {});
          errors.push(err);
        }
      }
      // Every provider failed: report the first one's error, the one to fix first.
      if (errors.length === providers.length) throw errors[0];
      return { hits: [], cached: false, costUsd };
    },
  };
}

/**
 * Records a Firecrawl scrape (the fetcher's last way to read a page) with the searches, so a run's
 * cost and the daily budget count its credits. Its key is the page's URL, which no search key matches.
 */
export async function recordScrape(runId: string | undefined, url: string, credits: number, costUsd: number) {
  await log({ runId, provider: "firecrawl", query: url, inputHash: sha256(url), credits, costUsd });
}

async function findCached(inputHash: string): Promise<{ hits: SearchResultItem[]; provider: string } | null> {
  const [row] = await db
    .select({ hits: searchCalls.hits, provider: searchCalls.provider })
    .from(searchCalls)
    .where(and(eq(searchCalls.inputHash, inputHash), isNull(searchCalls.error)))
    .orderBy(desc(searchCalls.createdAt))
    .limit(1);
  // An empty answer is never replayed (its backup may have failed): the next search asks again.
  return row?.hits?.length ? { hits: row.hits as SearchResultItem[], provider: row.provider } : null;
}

function log(row: {
  runId: string | undefined;
  provider: string;
  query: string;
  inputHash: string;
  hits?: SearchResultItem[];
  credits?: number;
  costUsd?: number;
  cached?: boolean;
  error?: string;
}) {
  return db.insert(searchCalls).values({
    runId: row.runId ?? null,
    provider: row.provider,
    query: row.query,
    inputHash: row.inputHash,
    hits: row.hits?.map((h) => ({ url: h.url, title: h.title, description: h.description, position: h.position })) ?? null,
    credits: row.credits ?? 0,
    costUsd: row.costUsd ?? 0,
    cached: row.cached ?? false,
    error: row.error ?? null,
  });
}
