import type { AiAccount, ModelChoice } from "@repo/contracts";
import { z } from "zod";

/** Each AI account's default models; MODEL_PLANNER and MODEL_WORKER override them. */
export const ACCOUNT_MODELS: Record<AiAccount, ModelChoice> = {
  api_key: { planner: "gpt-6-sol", worker: "gpt-6-luna" },
  // ChatGPT plans don't offer gpt-6-sol; gpt-5.6-terra passes the golden eval in its place.
  chatgpt: { planner: "gpt-5.6-terra", worker: "gpt-6-luna" },
};

const flag = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

/** Treats empty strings as "not set" so blank lines copied from .env.example don't fail validation. */
const unsetIfBlank = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

/** A local service's URL with its usual address as the default; a blank value turns the service off. */
const serviceUrl = (usual: string) =>
  z
    .string()
    .default(usual)
    .transform((v) => v || undefined)
    .pipe(z.string().url().optional());

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  /** Interface the API listens on; unset means this machine only, or every interface in production (a container). */
  HOST: unsetIfBlank,
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.string().default("info"),

  DATABASE_URL: z.string().url(),

  /** When set, RUVO uses OpenAI's API with this key; without it, your ChatGPT plan (see AI_ACCOUNT below). */
  OPENAI_API_KEY: unsetIfBlank,
  /** The sign-in server `bunx openai-oauth --detach` starts; used only without OPENAI_API_KEY. */
  OPENAI_OAUTH_URL: z.string().url().default("http://127.0.0.1:10531/v1"),
  /** The folder openai-oauth saves the ChatGPT sign-in in (auth.json), as for the Codex CLI; unset means ~/.codex. */
  CODEX_HOME: unsetIfBlank,
  /** Unset: the AI account's default (ACCOUNT_MODELS). */
  MODEL_PLANNER: unsetIfBlank,
  MODEL_WORKER: unsetIfBlank,
  LLM_CACHE_MODE: z.enum(["off", "on", "cache_only"]).default("on"),

  DECIDER_PROVIDER: z.enum(["jev", "laya", "off"]).default("jev"),
  DECIDER_BASE_URL: z.string().url().default("https://api.typesafe.ai"),
  DECIDER_MODEL: z.string().default("jev-1.13.0"),
  TYPESAFE_API_KEY: unsetIfBlank,
  /** off: never ask the decision model; shadow: ask and log, but don't act; active: act on confident answers. */
  DECIDER_MODE: z.enum(["off", "shadow", "active"]).default("active"),

  WORKER_INLINE: flag,
  FETCH_CACHE_MODE: z.enum(["off", "ttl", "prefer_cache", "cache_only"]).default("ttl"),
  USER_AGENT: z.string().default("RUVO/0.1 (+https://github.com/aizen2006/ruvo)"),
  /**
   * RUVO's Scrapling fetch service (infra/scrapling), which `bun run dev` starts with your local Scrapling.
   * Blank: pages are read with plain requests only (no browser, no stealth), e.g. on a host without Scrapling.
   */
  SCRAPLING_URL: serviceUrl("http://127.0.0.1:8001"),
  /** The Python that has Scrapling installed; unset means `python` on Windows and `python3` elsewhere. */
  SCRAPLING_PYTHON: unsetIfBlank,

  /** SearXNG, the local web search for finding sources (docker compose runs it); blank turns it off. */
  SEARXNG_URL: serviceUrl("http://127.0.0.1:8888"),
  /** Firecrawl (optional): the backup when SearXNG fails or finds nothing, and the last way to read a page Scrapling could not. */
  FIRECRAWL_API_KEY: unsetIfBlank,
  FIRECRAWL_BASE_URL: z.string().url().default("https://api.firecrawl.dev"),
  /** USD per Firecrawl credit, for cost estimates (Hobby: ~$16/5k credits). */
  FIRECRAWL_USD_PER_CREDIT: z.coerce.number().nonnegative().default(0.0032),
  MAX_SEARCHES: z.coerce.number().int().nonnegative().default(20),

  /** Ceilings for every run; each mode (quick, balanced, thorough) sets its own budgets below them. */
  MAX_PAGES: z.coerce.number().int().positive().default(300),
  MAX_BROWSER_PAGES: z.coerce.number().int().nonnegative().default(20),
  MAX_LLM_CALLS: z.coerce.number().int().nonnegative().default(150),
  MAX_RUN_MS: z.coerce.number().int().positive().default(480_000),
  /** Optional: no new runs once the last 24 hours of AI and search spend reach this many dollars; blank means no cap. */
  DAILY_BUDGET_USD: z.preprocess((v) => v || undefined, z.coerce.number().positive().optional()),
}).transform((e) => {
  /**
   * Whose AI RUVO uses, derived here only: an OpenAI API key, when set, overrides the ChatGPT sign-in.
   * api_key: OpenAI's API with OPENAI_API_KEY. chatgpt: your ChatGPT plan, through the openai-oauth sign-in server.
   */
  const AI_ACCOUNT: AiAccount = e.OPENAI_API_KEY ? "api_key" : "chatgpt";
  return {
    ...e,
    AI_ACCOUNT,
    MODEL_PLANNER: e.MODEL_PLANNER ?? ACCOUNT_MODELS[AI_ACCOUNT].planner,
    MODEL_WORKER: e.MODEL_WORKER ?? ACCOUNT_MODELS[AI_ACCOUNT].worker,
    // A ChatGPT plan has no AI spend to cap, so the daily cap is off there (MAX_SEARCHES still limits search per run).
    DAILY_BUDGET_USD: AI_ACCOUNT === "chatgpt" ? undefined : e.DAILY_BUDGET_USD,
  };
});

export type Env = z.infer<typeof EnvSchema>;

/** Parses an env source, throwing one readable error that lists every invalid variable. */
export function loadEnv(source: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}

