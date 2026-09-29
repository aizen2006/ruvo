import type { Budgets, ModeBudgets, ModelChoice, ModeOption, RunMode } from "@repo/contracts";
import type { Env } from "../config/env";

type ModelEnv = Pick<Env, "MODEL_PLANNER" | "MODEL_WORKER">;
type CeilingEnv = Pick<Env, "MAX_PAGES" | "MAX_BROWSER_PAGES" | "MAX_LLM_CALLS" | "MAX_RUN_MS" | "MAX_SEARCHES">;

interface Preset {
  label: string;
  blurb: string;
  /** Models relative to the configured pair, so an operator's MODEL_* choice still applies. */
  models: (e: ModelEnv) => ModelChoice;
  budgets: ModeBudgets;
}

/**
 * The three ways to run a request. Balanced is the default and matches RUVO's original limits;
 * the environment's MAX_* values are ceilings that no mode can exceed.
 */
const PRESETS: Record<RunMode, Preset> = {
  quick: {
    label: "Quick",
    blurb: "A first look from fewer sources, with little AI help",
    // Understanding stays on the planner model: the golden eval fails with luna there
    // ("preferably remote" read as a hard requirement).
    models: (e) => ({ planner: e.MODEL_PLANNER, worker: e.MODEL_WORKER }),
    budgets: { maxPages: 40, maxBrowserPages: 3, maxLlmCalls: 15, maxSearches: 3, maxDurationMs: 120_000 },
  },
  balanced: {
    label: "Balanced",
    blurb: "Good coverage at a low cost; right for most lists",
    models: (e) => ({ planner: e.MODEL_PLANNER, worker: e.MODEL_WORKER }),
    budgets: { maxPages: 150, maxBrowserPages: 10, maxLlmCalls: 60, maxSearches: 8, maxDurationMs: 240_000 },
  },
  thorough: {
    label: "Thorough",
    blurb: "More sources and the careful model for every step",
    models: (e) => ({ planner: e.MODEL_PLANNER, worker: e.MODEL_PLANNER }),
    budgets: { maxPages: 300, maxBrowserPages: 20, maxLlmCalls: 150, maxSearches: 20, maxDurationMs: 480_000 },
  },
};

const clampBudgets = (b: ModeBudgets, e: CeilingEnv): ModeBudgets => ({
  maxPages: Math.min(b.maxPages, e.MAX_PAGES),
  maxBrowserPages: Math.min(b.maxBrowserPages, e.MAX_BROWSER_PAGES),
  maxLlmCalls: Math.min(b.maxLlmCalls, e.MAX_LLM_CALLS),
  maxSearches: Math.min(b.maxSearches ?? 0, e.MAX_SEARCHES),
  maxDurationMs: Math.min(b.maxDurationMs, e.MAX_RUN_MS),
});

/** The modes as the dashboard offers them, with budgets already clamped to the ceilings. */
export const modeOptions = (e: ModelEnv & CeilingEnv): ModeOption[] =>
  (Object.keys(PRESETS) as RunMode[]).map((id) => ({
    id,
    label: PRESETS[id].label,
    blurb: PRESETS[id].blurb,
    models: PRESETS[id].models(e),
    budgets: clampBudgets(PRESETS[id].budgets, e),
  }));

/** Models for a new run: the mode's pair, with any explicit choice taking precedence. */
export const modelsForMode = (mode: RunMode, chosen: Partial<ModelChoice> | undefined, e: ModelEnv): ModelChoice => ({
  ...PRESETS[mode].models(e),
  ...Object.fromEntries(Object.entries(chosen ?? {}).filter(([, v]) => v)),
});

/** Budget caps for a run: its mode's budgets, never above the environment's ceilings. */
export const budgetsForMode = (mode: RunMode, e: CeilingEnv, maxRecords = 500): Budgets => ({
  ...clampBudgets(PRESETS[mode].budgets, e),
  maxRecords,
});

/** A stored run's models; runs created before modes existed fall back to the configured pair. */
export const runModels = (run: { modelPlanner: string | null; modelWorker: string | null }, e: ModelEnv): ModelChoice => ({
  planner: run.modelPlanner ?? e.MODEL_PLANNER,
  worker: run.modelWorker ?? e.MODEL_WORKER,
});
