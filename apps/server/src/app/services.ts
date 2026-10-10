import type { Env } from "../config/env";
import { createDecider, type Decider } from "../decide/decider";
import { createSystemOneClient } from "../decide/systemOneClient";
import { createDocparse, type Docparse } from "../documents/sandbox";
import { createFetcher, type Fetcher } from "../fetch/fetcher";
import { createRobots } from "../fetch/robots";
import { createScraplingClient, type ScraplingClient } from "../fetch/scrapling";
import { logger } from "../libs/logger";
import { createLlmClient, type LlmClient } from "../llm/client";
import { createWorkflowMemory, type WorkflowMemory } from "../memory/workflowMemory";
import type { WebSearch } from "../plan/webDiscovery";
import { createSearchRunner } from "../search/cache";
import { createFirecrawl } from "../search/firecrawl";
import { createSearxng } from "../search/searxng";

/**
 * The services every run in a process shares, so robots.txt rules, per-host rate limits and circuit breakers
 * apply across runs. The API and the worker build them once at startup; saved settings apply on restart.
 */
export interface Services {
  /** RUVO's Scrapling fetch service: plain requests, the browser and the stealth browser. Off when SCRAPLING_URL is blank. */
  scrapling?: ScraplingClient;
  fetcher: Fetcher;
  llm: LlmClient;
  /** Web search for finding sources (SearXNG, then Firecrawl); null with neither, so RUVO plans only known and linked sources. */
  webSearch: WebSearch | null;
  decider: Decider;
  /** Plans that worked, kept in Postgres, so paraphrased requests can reuse them. */
  memory: WorkflowMemory;
  /** The document sandbox, as DOCPARSE says to run it. */
  docparse: Docparse;
}

export function createServices(env: Env): Services {
  // RUVO's own demo site (see fixtures/careersSite) is reachable despite the private-network guards;
  // it isn't served in production, so nothing local is trusted there.
  const trustedOrigins = env.NODE_ENV === "production" ? [] : [`http://localhost:${env.PORT}`];
  const scrapling = env.SCRAPLING_URL ? createScraplingClient(env.SCRAPLING_URL) : undefined;
  // SearXNG, the free local web search; off when SEARXNG_URL is blank.
  const searxng = env.SEARXNG_URL ? createSearxng(env.SEARXNG_URL) : undefined;
  // Firecrawl (with a key): the backup web search, and the last way to read a page.
  const firecrawl = env.FIRECRAWL_API_KEY ? createFirecrawl({ apiKey: env.FIRECRAWL_API_KEY, baseUrl: env.FIRECRAWL_BASE_URL }) : undefined;
  // Shared with web discovery, so it never plans a page the fetcher would refuse.
  const robots = createRobots({ userAgent: env.USER_AGENT, scrapling });
  // Jev (hosted) or Laya (self-hosted) behind one client; null when the decision layer is off.
  const provider =
    env.DECIDER_PROVIDER === "off" || (env.DECIDER_PROVIDER === "jev" && !env.TYPESAFE_API_KEY)
      ? null
      : createSystemOneClient({ baseUrl: env.DECIDER_BASE_URL, model: env.DECIDER_MODEL, apiKey: env.TYPESAFE_API_KEY });

  return {
    scrapling,
    fetcher: createFetcher({
      userAgent: env.USER_AGENT,
      robots,
      cacheMode: env.FETCH_CACHE_MODE,
      scrapling,
      firecrawl: firecrawl && { client: firecrawl, usdPerCredit: env.FIRECRAWL_USD_PER_CREDIT },
      trustedOrigins,
    }),
    llm: createLlmClient({ env }),
    webSearch:
      searxng || firecrawl
        ? { searcher: createSearchRunner({ searxng, firecrawl, usdPerCredit: env.FIRECRAWL_USD_PER_CREDIT, cacheMode: env.FETCH_CACHE_MODE }), robots }
        : null,
    decider: createDecider({ provider, mode: env.DECIDER_MODE }),
    memory: createWorkflowMemory({ log: logger.child({ component: "memory" }) }),
    docparse: createDocparse(env.DOCPARSE),
  };
}
