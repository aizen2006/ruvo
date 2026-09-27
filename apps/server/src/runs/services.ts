import { env } from "../config/env";
import { createFetcher } from "../fetch/fetcher";
import { createLlmClient } from "../llm/client";

/**
 * Process-wide service instances shared by every run in this process, so robots.txt rules,
 * per-host rate limits and circuit breakers apply across runs.
 */
export const fetcher = createFetcher({ userAgent: env.USER_AGENT, cacheMode: env.FETCH_CACHE_MODE });
export const llm = createLlmClient({ env });
