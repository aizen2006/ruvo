import { z } from "zod";

/**
 * How thorough a run is. A mode picks the models and the run's budgets; the dashboard
 * shows it as a plain choice with a cost estimate.
 */
export const RUN_MODES = ["quick", "balanced", "thorough"] as const;
export const RunMode = z.enum(RUN_MODES);
export type RunMode = z.infer<typeof RunMode>;

/** Which model does which job: `planner` understands and plans, `worker` reads and judges. */
export const ModelChoice = z.object({ planner: z.string().min(1), worker: z.string().min(1) });
export type ModelChoice = z.infer<typeof ModelChoice>;

export const ModeBudgets = z.object({
  maxPages: z.number(),
  maxBrowserPages: z.number(),
  maxLlmCalls: z.number(),
  maxDurationMs: z.number(),
});
export type ModeBudgets = z.infer<typeof ModeBudgets>;

export const ModelOption = z.object({
  id: z.string(),
  label: z.string(),
  blurb: z.string(),
  /** USD per million tokens. */
  inputPerMillion: z.number(),
  outputPerMillion: z.number(),
});
export type ModelOption = z.infer<typeof ModelOption>;

export const ModeOption = z.object({
  id: RunMode,
  label: z.string(),
  blurb: z.string(),
  models: ModelChoice,
  budgets: ModeBudgets,
});
export type ModeOption = z.infer<typeof ModeOption>;

/** GET /api/options: everything the dashboard needs to offer modes, models and estimates. */
export const RunOptions = z.object({
  defaultMode: RunMode,
  modes: z.array(ModeOption),
  models: z.array(ModelOption),
});
export type RunOptions = z.infer<typeof RunOptions>;

export interface CostEstimate {
  /** What a typical run of this size costs. */
  typicalUsd: number;
  /** What the run costs if it spends its whole AI-call budget. */
  highUsd: number;
}

/**
 * Typical tokens per LLM call by role, measured from `llm_calls` on real runs (2026-09-29):
 * compile and plan average about 1,400 in and 1,150 out; judging a batch about 1,600 in and 350 out.
 * Compile and plan are one planner call each; calls during collection count against the AI-call budget.
 */
const TYPICAL_CALL = {
  planner: { tokensIn: 1400, tokensOut: 1150 },
  worker: { tokensIn: 1600, tokensOut: 350 },
} as const;
/** Share of the AI-call budget a typical run spends; most values come from APIs and pages (measured: ~5%). */
const TYPICAL_BUDGET_SHARE = 0.15;

/**
 * Cost estimate for a run, shared by the server (options) and the dashboard (live model picker).
 * Cached calls cost nothing, so re-runs usually land well below it. Unknown models count as free.
 */
export function estimateRunCost(models: ModelChoice, maxLlmCalls: number, catalog: ModelOption[]): CostEstimate {
  const callCost = (model: string, role: keyof typeof TYPICAL_CALL) => {
    const price = catalog.find((m) => m.id === model);
    if (!price) return 0;
    const { tokensIn, tokensOut } = TYPICAL_CALL[role];
    return (tokensIn * price.inputPerMillion + tokensOut * price.outputPerMillion) / 1_000_000;
  };
  const setup = 2 * callCost(models.planner, "planner");
  const perCall = callCost(models.worker, "worker");
  return {
    typicalUsd: setup + Math.ceil(maxLlmCalls * TYPICAL_BUDGET_SHARE) * perCall,
    highUsd: setup + maxLlmCalls * perCall,
  };
}
