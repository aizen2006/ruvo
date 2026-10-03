import { z } from "zod";
import { AiAccount, ModelChoice, ModelOption } from "./options";

/**
 * The settings the dashboard's Settings page can change, by their names in apps/server/.env.
 * Base URLs, ports and the database are changed in .env only.
 */
export const SECRET_SETTINGS = ["OPENAI_API_KEY", "FIRECRAWL_API_KEY", "TYPESAFE_API_KEY"] as const;
export const VALUE_SETTINGS = [
  "MODEL_PLANNER",
  "MODEL_WORKER",
  "MAX_SEARCHES",
  "DECIDER_PROVIDER",
  "DECIDER_MODE",
  "MAX_PAGES",
  "MAX_BROWSER_PAGES",
  "MAX_LLM_CALLS",
  "MAX_RUN_MS",
  "DAILY_BUDGET_USD",
  "FETCH_CACHE_MODE",
  "LLM_CACHE_MODE",
] as const;
export type SecretSetting = (typeof SECRET_SETTINGS)[number];
export type ValueSetting = (typeof VALUE_SETTINGS)[number];

/** GET /api/settings (not served in production): what RUVO runs with. Secrets are never sent. */
export const Settings = z.object({
  account: AiAccount,
  /** When the API started; saving restarts it, and a new value means the restarted API answers. */
  startedAt: z.number(),
  /** As .env would write them; "" means unset (the models: the account's default; the daily budget: no cap). */
  values: z.record(z.enum(VALUE_SETTINGS), z.string()),
  /** Whether each secret is set, with at most its last 4 characters. */
  secrets: z.record(z.enum(SECRET_SETTINGS), z.object({ set: z.boolean(), last4: z.string().optional() })),
  /** The account's models to choose from, and the ones it uses when none is chosen. */
  models: z.array(ModelOption),
  defaultModels: ModelChoice,
});
export type Settings = z.infer<typeof Settings>;

/** PUT /api/settings: only the settings to change; "" unsets one (removes a secret). RUVO then restarts. */
export const SettingsUpdate = z.partialRecord(z.enum([...SECRET_SETTINGS, ...VALUE_SETTINGS]), z.string().trim());
export type SettingsUpdate = z.infer<typeof SettingsUpdate>;
