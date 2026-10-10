import {
  emptyMetrics,
  type Budgets,
  type DatasetContract,
  type EvidenceMethod,
  type Recipe,
  type RunEvent,
  type RunMetrics,
  type Stage,
  type WorkflowIR,
} from "@repo/contracts";
import type { Decider } from "../decide/decider";
import type { Fetcher } from "../fetch/fetcher";
import type { ScraplingClient } from "../fetch/scrapling";
import type { Logger } from "../libs/logger";
import type { LlmClient } from "../llm/client";

/**
 * A run as every layer sees it: its context, budgets, counters and events. Lower layers (fetch, llm,
 * adapters, …) import these from here; runs/ builds the context and persists what it records.
 */

/**
 * Everything a pipeline step needs for one run. Steps depend on this interface,
 * not on globals, so they stay testable with a fake context.
 * Services (fetcher, LLM client, decider, …) are added here as they are built.
 */
export interface RunContext {
  runId: string;
  signal: AbortSignal;
  contract: DatasetContract;
  ir: WorkflowIR;
  budget: Budget;
  metrics: Metrics;
  fetcher: Fetcher;
  llm: LlmClient;
  decider: Decider;
  /** RUVO's Scrapling service, which re-finds a changed recipe's fields (repair/relocate); absent when SCRAPLING_URL is blank. */
  scrapling?: ScraplingClient;
  log: Logger;
  /** Recipe repairs made during the run; they become a new workflow version when it ends. */
  repairs: RepairNote[];
  /** Pages a paginated list source may read (the run mode's cap); 1 when unset. */
  maxListPages?: number;
  /** Source branches read at once (the run mode's); the executor's default when unset. */
  branchConcurrency?: number;
  /** When the run's time limit ends (epoch ms), set while its sources are read; a fetch waits out a long Retry-After only if it ends sooner. */
  endsAt?: number;
  emit(event: EmitInput): void;
  /** Moves the run to a new user-facing stage (persisted and announced). */
  setStage(stage: Stage): Promise<void>;
}

export interface RepairNote {
  host: string;
  fromVersion: number;
  toVersion: number;
  origin: Recipe["origin"];
  failure: string;
}

export type EmitInput = {
  stage: Stage;
  type: string;
  message: string;
  level?: RunEvent["level"];
  sourceId?: string | null;
  data?: unknown;
};

export type BudgetKey = "pages" | "browserPages" | "llmCalls" | "searches";

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
  searches: (b) => b.maxSearches ?? 0,
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
    searches: limits.maxSearches ?? 0,
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

type CounterKey = Exclude<keyof RunMetrics, "llmCostUsd" | "decisions" | "fieldsByMethod">;
type DecisionTier = keyof RunMetrics["decisions"];

/** In-memory run counters; snapshots are persisted to `runs.metrics` by the run context. */
export interface Metrics {
  inc(key: CounterKey, n?: number): void;
  /** Overwrites a counter with an authoritative value (e.g. recounted from the database). */
  set(key: CounterKey, n: number): void;
  addCost(usd: number): void;
  method(method: EvidenceMethod, n?: number): void;
  decision(tier: DecisionTier): void;
  snapshot(): RunMetrics;
}

/** Starts from `initial` so a re-attempted run keeps counting where it left off. */
export function createMetrics(initial: RunMetrics = emptyMetrics()): Metrics {
  const m: RunMetrics = structuredClone(initial);
  return {
    inc: (key, n = 1) => void (m[key] += n),
    set: (key, n) => void (m[key] = n),
    addCost: (usd) => void (m.llmCostUsd += usd),
    method: (method, n = 1) => void (m.fieldsByMethod[method] = (m.fieldsByMethod[method] ?? 0) + n),
    decision: (tier) => void (m.decisions[tier] += 1),
    snapshot: () => structuredClone(m),
  };
}
