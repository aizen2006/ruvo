import { z } from "zod";

const flag = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

/** Treats empty strings as "not set" so blank lines copied from .env.example don't fail validation. */
const unsetIfBlank = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  /** Interface the API listens on; unset means this machine only, or every interface in production (a container). */
  HOST: unsetIfBlank,
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.string().default("info"),

  DATABASE_URL: z.string().url(),

  OPENAI_API_KEY: unsetIfBlank,
  MODEL_PLANNER: z.string().default("gpt-6-sol"),
  MODEL_WORKER: z.string().default("gpt-6-luna"),
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
  /** RUVO's Scrapling fetch service (infra/scrapling), which `bun run dev` starts with your local Scrapling. */
  SCRAPLING_URL: z.string().url().default("http://127.0.0.1:8001"),
  /** The Python that has Scrapling installed; unset means `python` on Windows and `python3` elsewhere. */
  SCRAPLING_PYTHON: unsetIfBlank,

  /** Firecrawl (optional): web search for finding sources. Without a key, RUVO plans only known and linked sources. */
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
  /** Optional: no new runs once the last 24 hours of AI and search spend reach this many dollars. */
  DAILY_BUDGET_USD: z.coerce.number().positive().optional(),
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

