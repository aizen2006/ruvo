import { env } from "../config/env";
import { createDecider } from "../decide/decider";
import { createSystemOneClient } from "../decide/systemOneClient";
import { createFetcher } from "../fetch/fetcher";
import { createLlmClient } from "../llm/client";

/**
 * Process-wide service instances shared by every run in this process, so robots.txt rules,
 * per-host rate limits and circuit breakers apply across runs.
 */
export const fetcher = createFetcher({ userAgent: env.USER_AGENT, cacheMode: env.FETCH_CACHE_MODE });
export const llm = createLlmClient({ env });

/** Jev (hosted) or Laya (self-hosted) behind one client; null when the decision layer is off. */
const provider =
  env.DECIDER_PROVIDER === "off" || (env.DECIDER_PROVIDER === "jev" && !env.TYPESAFE_API_KEY)
    ? null
    : createSystemOneClient({ baseUrl: env.DECIDER_BASE_URL, model: env.DECIDER_MODEL, apiKey: env.TYPESAFE_API_KEY });
export const decider = createDecider({ provider, mode: env.DECIDER_MODE });
