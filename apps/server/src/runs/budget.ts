import type { Budgets } from "@repo/contracts";

export type BudgetKey = "pages" | "browserPages" | "llmCalls";

/**
 * Per-run spending caps. Callers ask before spending (`take`) and degrade gracefully
 * when refused, e.g. "salary: not attempted (LLM budget)", instead of failing the run.
 */
export interface Budget {
  take(key: BudgetKey, n?: number): boolean;
  left(key: BudgetKey): number;
  /** True once the run has exceeded its wall-clock allowance. */
  expired(): boolean;
}

export function createBudget(limits: Budgets, now: () => number = Date.now): Budget {
  const remaining: Record<BudgetKey, number> = {
    pages: limits.maxPages,
    browserPages: limits.maxBrowserPages,
    llmCalls: limits.maxLlmCalls,
  };
  const deadline = now() + limits.maxDurationMs;

  return {
    take(key, n = 1) {
      if (remaining[key] < n) return false;
      remaining[key] -= n;
      return true;
    },
    left: (key) => remaining[key],
    expired: () => now() > deadline,
  };
}
