import { env } from "../config/env";
import { createDecider } from "../decide/decider";
import { createSystemOneClient } from "../decide/systemOneClient";
import { createFetcher } from "../fetch/fetcher";
import { createRobots } from "../fetch/robots";
import { createScraplingClient } from "../fetch/scrapling";
import { createLlmClient } from "../llm/client";
import { logger } from "../libs/logger";
import type { WebSearch } from "../plan/webDiscovery";
import { createSearchRunner } from "../search/cache";
import { createFirecrawl } from "../search/firecrawl";
import { createSearxng } from "../search/searxng";
import { createWorkflowMemory } from "../memory/workflowMemory";

/**
 * Process-wide service instances shared by every run in this process, so robots.txt rules,
 * per-host rate limits and circuit breakers apply across runs.
 */
// RUVO's own demo site (see fixtures/careersSite) is reachable despite the private-network guards;
// it isn't served in production, so nothing local is trusted there.
const trustedOrigins = env.NODE_ENV === "production" ? [] : [`http://localhost:${env.PORT}`];
/** RUVO's Scrapling fetch service: plain requests, the browser and the stealth browser. Off when SCRAPLING_URL is blank. */
const scrapling = env.SCRAPLING_URL ? createScraplingClient(env.SCRAPLING_URL) : undefined;
/** SearXNG, the free local web search; off when SEARXNG_URL is blank. */
const searxng = env.SEARXNG_URL ? createSearxng(env.SEARXNG_URL) : undefined;
/** Firecrawl (with a key): the backup web search, and the last way to read a page. */
const firecrawl = env.FIRECRAWL_API_KEY ? createFirecrawl({ apiKey: env.FIRECRAWL_API_KEY, baseUrl: env.FIRECRAWL_BASE_URL }) : undefined;
/** Shared with web discovery, so it never plans a page the fetcher would refuse. */
export const robots = createRobots({ userAgent: env.USER_AGENT, scrapling });
export const fetcher = createFetcher({
  userAgent: env.USER_AGENT,
  robots,
  cacheMode: env.FETCH_CACHE_MODE,
  scrapling,
  firecrawl: firecrawl && { client: firecrawl, usdPerCredit: env.FIRECRAWL_USD_PER_CREDIT },
  trustedOrigins,
});
export const llm = createLlmClient({ env });

/** Web search for finding sources (SearXNG, then Firecrawl); null with neither, so RUVO plans only known and linked sources. */
export const webSearch: WebSearch | null =
  searxng || firecrawl
    ? { searcher: createSearchRunner({ searxng, firecrawl, usdPerCredit: env.FIRECRAWL_USD_PER_CREDIT, cacheMode: env.FETCH_CACHE_MODE }), robots }
    : null;

/** Jev (hosted) or Laya (self-hosted) behind one client; null when the decision layer is off. */
const provider =
  env.DECIDER_PROVIDER === "off" || (env.DECIDER_PROVIDER === "jev" && !env.TYPESAFE_API_KEY)
    ? null
    : createSystemOneClient({ baseUrl: env.DECIDER_BASE_URL, model: env.DECIDER_MODEL, apiKey: env.TYPESAFE_API_KEY });
export const decider = createDecider({ provider, mode: env.DECIDER_MODE });

/** Plans that worked, kept in Postgres, so paraphrased requests can reuse them. */
export const memory = createWorkflowMemory({ log: logger.child({ component: "memory" }) });
