import { emptyMetrics, type EvidenceMethod, type RunMetrics } from "@repo/contracts";

type CounterKey = Exclude<keyof RunMetrics, "llmCostUsd" | "decisions" | "fieldsByMethod">;
type DecisionTier = keyof RunMetrics["decisions"];

/** In-memory run counters; snapshots are persisted to `runs.metrics` by the run context. */
export interface Metrics {
  inc(key: CounterKey, n?: number): void;
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
    addCost: (usd) => void (m.llmCostUsd += usd),
    method: (method, n = 1) => void (m.fieldsByMethod[method] = (m.fieldsByMethod[method] ?? 0) + n),
    decision: (tier) => void (m.decisions[tier] += 1),
    snapshot: () => structuredClone(m),
  };
}
