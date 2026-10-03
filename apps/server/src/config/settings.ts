import { SECRET_SETTINGS, VALUE_SETTINGS, type Settings, type SettingsUpdate } from "@repo/contracts";
import { utimes } from "node:fs/promises";
import { join } from "node:path";
import { badRequest } from "../libs/errors";
import { modelCatalog } from "../llm/models";
import { env, type Env } from "./env";
import { ACCOUNT_MODELS, loadEnv } from "./envSchema";

/**
 * The settings the dashboard's Settings page changes. They live in apps/server/.env like every other
 * setting and are read once at startup, so saving rewrites their lines there and restarts RUVO.
 */

/** apps/server/.env, which Bun loads at startup (`bun run dev` runs in apps/server). */
const ENV_FILE = join(import.meta.dir, "..", "..", ".env");
/** Tells this process apart from the one a restart brings up. */
const STARTED_AT = Date.now();
/** Blank means something for these (the account's default model, no daily cap), so they are shown as written. */
const AS_WRITTEN: string[] = ["MODEL_PLANNER", "MODEL_WORKER", "DAILY_BUDGET_USD"];
/** Values .env reads back exactly as written: it cuts at #, expands $, and treats quotes, backslashes and spaces specially. */
const PLAIN = /^[\w.:/+=@,-]*$/;

/** Whether a secret is set, and its last 4 characters once it is long enough that they give little away. */
export const maskSecret = (value: string | undefined) => ({ set: Boolean(value), last4: value && value.length >= 12 ? value.slice(-4) : undefined });

export function readSettings(): Settings {
  const shown = (key: (typeof VALUE_SETTINGS)[number]) => (AS_WRITTEN.includes(key) ? (process.env[key] ?? "") : String(env[key]));
  return {
    account: env.AI_ACCOUNT,
    startedAt: STARTED_AT,
    values: Object.fromEntries(VALUE_SETTINGS.map((key) => [key, shown(key)])) as Settings["values"],
    secrets: Object.fromEntries(SECRET_SETTINGS.map((key) => [key, maskSecret(env[key])])) as Settings["secrets"],
    models: modelCatalog(),
    defaultModels: ACCOUNT_MODELS[env.AI_ACCOUNT],
  };
}

/**
 * Checks the settings RUVO would start with after `changes` (the same schema as at startup), then
 * writes `changes` to .env. Errors name the setting and the problem, never a value.
 */
export async function saveSettings(changes: SettingsUpdate) {
  for (const [key, value = ""] of Object.entries(changes)) {
    if (!PLAIN.test(value)) throw badRequest(`${key} can't contain spaces, quotes, #, $ or backslashes.`);
  }
  let next: Env;
  try {
    next = loadEnv({ ...process.env, ...changes });
  } catch (err) {
    throw badRequest((err as Error).message);
  }
  // Adding or removing the API key switches the account, and each account offers its own models.
  for (const key of ["MODEL_PLANNER", "MODEL_WORKER"] as const) {
    if (!modelCatalog(next.AI_ACCOUNT).some((m) => m.id === next[key])) {
      const where = next.AI_ACCOUNT === "chatgpt" ? "on the ChatGPT plan" : "with an API key";
      throw badRequest(`${key}: ${next[key]} isn't offered ${where}. Choose another model, or leave it blank for the default.`);
    }
  }
  const file = Bun.file(ENV_FILE);
  await Bun.write(ENV_FILE, updateEnvText((await file.exists()) ? await file.text() : "", changes));
}

/**
 * Restarts the API and the worker so they read the saved settings. `bun run dev` runs both under
 * `bun --watch`, which restarts a process when a module it imports changes but not when .env does,
 * so this touches env.ts, which both import. Started any other way, they keep the old settings until restarted.
 */
export async function restartRuvo() {
  const now = new Date();
  await utimes(join(import.meta.dir, "env.ts"), now, now);
}

/**
 * A .env file's text with `changes` written: a key's line is updated where it exists, keeping its comment,
 * and added at the end otherwise. Every other line and comment stays as it was.
 */
export function updateEnvText(text: string, changes: SettingsUpdate): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text ? text.replace(/\r?\n$/, "").split(/\r?\n/) : [];
  for (const [key, value = ""] of Object.entries(changes)) {
    // KEY=value, then an optional comment, which Bun starts at any # (`LLM_CACHE_MODE=on   # off | on | cache_only`).
    const pattern = new RegExp(`^(\\s*${key}\\s*=)(.*?)(\\s*#.*)?$`);
    let found = false;
    for (const [i, line] of lines.entries()) {
      const match = pattern.exec(line);
      if (!match) continue;
      lines[i] = `${match[1]}${value}${match[3] ?? ""}`;
      found = true;
    }
    // Unsetting a key the file doesn't have changes nothing.
    if (!found && value) lines.push(`${key}=${value}`);
  }
  return lines.join(eol) + eol;
}
