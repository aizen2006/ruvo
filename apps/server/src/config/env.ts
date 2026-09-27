import { loadEnv } from "./envSchema";

export type { Env } from "./envSchema";

/** Process-wide validated configuration. Import this, never `process.env`, in app code. */
export const env = loadEnv(process.env);

/** Returns a secret or throws a clear error naming the feature that needs it. */
export function requireSecret(name: "OPENAI_API_KEY" | "TYPESAFE_API_KEY", feature: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set; it is required for ${feature}.`);
  return value;
}
