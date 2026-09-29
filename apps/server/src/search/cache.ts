import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { searchCalls } from "../db/schema";
import { sha256, stableStringify } from "../libs/hash";
import type { FetchScope } from "../fetch/fetcher";
import type { FirecrawlClient, SearchResultItem } from "./firecrawl";

/**
 * Runs a web search through a provider, caching results in `search_calls` so re-runs are free and
 * reproducible (mirroring the LLM cache). Also records what each live search cost.
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

export interface SearchRunnerDeps {
  firecrawl: FirecrawlClient;
  usdPerCredit: number;
  /** off replays cache only; on caches live calls; cache_only never calls out. Follows FETCH_CACHE_MODE. */
  cacheMode: "off" | "ttl" | "prefer_cache" | "cache_only";
}

export function createSearchRunner(deps: SearchRunnerDeps): SearchRunner {
  const { firecrawl, usdPerCredit, cacheMode } = deps;

  return {
    async run(query, { limit, runId, scope }) {
      const inputHash = sha256(stableStringify({ provider: "firecrawl", query, limit }));

      if (cacheMode !== "off") {
        const hit = await findCached(inputHash);
        if (hit) {
          await log({ runId, query, inputHash, hits: hit, cached: true });
          return { hits: hit, cached: true, costUsd: 0 };
        }
        if (cacheMode === "cache_only") return null;
      }

      // A live search spends from the run's budget; degrade quietly when it's used up.
      if (!scope.budget.take("searches")) return null;

      try {
        const res = await firecrawl.search(query, { limit, signal: scope.signal });
        const costUsd = res.creditsUsed * usdPerCredit;
        await log({ runId, query, inputHash, hits: res.web, credits: res.creditsUsed, costUsd });
        return { hits: res.web, cached: false, costUsd };
      } catch (err) {
        await log({ runId, query, inputHash, error: err instanceof Error ? err.message : String(err) }).catch(() => {});
        throw err;
      }
    },
  };
}

async function findCached(inputHash: string): Promise<SearchResultItem[] | null> {
  const [row] = await db
    .select({ hits: searchCalls.hits })
    .from(searchCalls)
    .where(and(eq(searchCalls.inputHash, inputHash), isNull(searchCalls.error)))
    .orderBy(desc(searchCalls.createdAt))
    .limit(1);
  return (row?.hits as SearchResultItem[] | undefined) ?? null;
}

function log(row: {
  runId: string;
  query: string;
  inputHash: string;
  hits?: SearchResultItem[];
  credits?: number;
  costUsd?: number;
  cached?: boolean;
  error?: string;
}) {
  return db.insert(searchCalls).values({
    runId: row.runId,
    provider: "firecrawl",
    query: row.query,
    inputHash: row.inputHash,
    hits: row.hits?.map((h) => ({ url: h.url, title: h.title, description: h.description, position: h.position })) ?? null,
    credits: row.credits ?? 0,
    costUsd: row.costUsd ?? 0,
    cached: row.cached ?? false,
    error: row.error ?? null,
  });
}
