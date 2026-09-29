import { z } from "zod";

const flag = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

/** Treats empty strings as "not set" so blank lines copied from .env.example don't fail validation. */
const optionalSecret = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.string().default("info"),

  DATABASE_URL: z.string().url(),
  QDRANT_URL: z.string().url().default("http://localhost:6333"),

  OPENAI_API_KEY: optionalSecret,
  MODEL_PLANNER: z.string().default("gpt-6-sol"),
  MODEL_WORKER: z.string().default("gpt-6-luna"),
  EMBED_MODEL: z.string().default("text-embedding-3-small"),
  LLM_CACHE_MODE: z.enum(["off", "on", "cache_only"]).default("on"),

  DECIDER_PROVIDER: z.enum(["jev", "laya", "off"]).default("jev"),
  DECIDER_BASE_URL: z.string().url().default("https://api.typesafe.ai"),
  DECIDER_MODEL: z.string().default("jev-1.13.0"),
  TYPESAFE_API_KEY: optionalSecret,
  /** off: never ask the decision model; shadow: ask and log, but don't act; active: act on confident answers. */
  DECIDER_MODE: z.enum(["off", "shadow", "active"]).default("active"),

  WORKER_INLINE: flag,
  FETCH_CACHE_MODE: z.enum(["off", "ttl", "prefer_cache", "cache_only"]).default("ttl"),
  USER_AGENT: z.string().default("RUVO/0.1 (+https://github.com/aizen2006/ruvo)"),

  /** Ceilings for every run; each mode (quick, balanced, thorough) sets its own budgets below them. */
  MAX_PAGES: z.coerce.number().int().positive().default(300),
  MAX_BROWSER_PAGES: z.coerce.number().int().nonnegative().default(20),
  MAX_LLM_CALLS: z.coerce.number().int().nonnegative().default(150),
  MAX_RUN_MS: z.coerce.number().int().positive().default(480_000),
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

