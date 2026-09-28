import type { Budgets } from "@repo/contracts";

export type BudgetKey = "pages" | "browserPages" | "llmCalls";

/**
 * Per-run spending caps (the time limit is enforced by the executor). Callers ask before
 * spending (`take`) and degrade gracefully when refused, e.g. "salary: not attempted
 * (LLM budget)", instead of failing the run.
 */
export interface Budget {
  take(key: BudgetKey, n?: number): boolean;
  left(key: BudgetKey): number;
}

const LIMIT_OF: Record<BudgetKey, (b: Budgets) => number> = {
  pages: (b) => b.maxPages,
  browserPages: (b) => b.maxBrowserPages,
  llmCalls: (b) => b.maxLlmCalls,
};

/**
 * @param onExhausted called once per budget, the first time a request is refused, so the run
 *   can tell the user what was skipped.
 */
export function createBudget(limits: Budgets, onExhausted?: (key: BudgetKey, limit: number) => void): Budget {
  const remaining: Record<BudgetKey, number> = {
    pages: limits.maxPages,
    browserPages: limits.maxBrowserPages,
    llmCalls: limits.maxLlmCalls,
  };
  const announced = new Set<BudgetKey>();

  return {
    take(key, n = 1) {
      if (remaining[key] < n) {
        if (!announced.has(key)) {
          announced.add(key);
          onExhausted?.(key, LIMIT_OF[key](limits));
        }
        return false;
      }
      remaining[key] -= n;
      return true;
    },
    left: (key) => remaining[key],
  };
}

/** Per-run caps from the environment; the IR compiler clamps planned budgets to these. */
export const budgetsFromEnv = (e: {
  MAX_PAGES: number;
  MAX_BROWSER_PAGES: number;
  MAX_LLM_CALLS: number;
  MAX_RUN_MS: number;
}, maxRecords = 500): Budgets => ({
  maxPages: e.MAX_PAGES,
  maxBrowserPages: e.MAX_BROWSER_PAGES,
  maxLlmCalls: e.MAX_LLM_CALLS,
  maxDurationMs: e.MAX_RUN_MS,
  maxRecords,
});

/**
 * A view of `budget` that lets one step spend at most `max` of `key`, still drawing from the
 * run's budget. Used where a step has its own allowance, e.g. triage's LLM judge calls.
 */
export function withCap(budget: Budget, key: BudgetKey, max: number): Budget {
  let used = 0;
  return {
    take(k, n = 1) {
      if (k !== key) return budget.take(k, n);
      if (used + n > max || !budget.take(k, n)) return false;
      used += n;
      return true;
    },
    left: (k) => (k === key ? Math.min(max - used, budget.left(k)) : budget.left(k)),
  };
}
