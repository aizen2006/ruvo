import { env } from "../config/env";
import { createDecider } from "../decide/decider";
import { createSystemOneClient } from "../decide/systemOneClient";
import { createBrowserPool } from "../fetch/browser";
import { createFetcher } from "../fetch/fetcher";
import { createLlmClient } from "../llm/client";
import { logger } from "../libs/logger";
import { createFirecrawl, firecrawlDisabled, type MaybeFirecrawl } from "../search/firecrawl";
import { createEmbedder } from "../memory/embeddings";
import { createQdrant } from "../memory/qdrant";
import { createWorkflowMemory } from "../memory/workflowMemory";

/**
 * Process-wide service instances shared by every run in this process, so robots.txt rules,
 * per-host rate limits and circuit breakers apply across runs.
 */
// RUVO's own demo site (see fixtures/careersSite) is reachable despite the private-network guards.
const trustedOrigins = [`http://localhost:${env.PORT}`];
export const browser = createBrowserPool({ userAgent: env.USER_AGENT, maxPages: 2, trustedOrigins });
export const fetcher = createFetcher({
  userAgent: env.USER_AGENT,
  cacheMode: env.FETCH_CACHE_MODE,
  browser,
  trustedOrigins,
});
export const llm = createLlmClient({ env });

/** Firecrawl for web search, crawl and extraction; disabled (RUVO's own fetcher only) without a key. */
export const firecrawl: MaybeFirecrawl = env.FIRECRAWL_API_KEY
  ? createFirecrawl({ apiKey: env.FIRECRAWL_API_KEY, baseUrl: env.FIRECRAWL_BASE_URL })
  : firecrawlDisabled;

/** Jev (hosted) or Laya (self-hosted) behind one client; null when the decision layer is off. */
const provider =
  env.DECIDER_PROVIDER === "off" || (env.DECIDER_PROVIDER === "jev" && !env.TYPESAFE_API_KEY)
    ? null
    : createSystemOneClient({ baseUrl: env.DECIDER_BASE_URL, model: env.DECIDER_MODEL, apiKey: env.TYPESAFE_API_KEY });
export const decider = createDecider({ provider, mode: env.DECIDER_MODE });

/** Plans that worked, in Qdrant, so paraphrased requests can reuse them. */
export const memory = createWorkflowMemory({
  embed: createEmbedder(env),
  store: createQdrant({ url: env.QDRANT_URL }),
  log: logger.child({ component: "memory" }),
});
