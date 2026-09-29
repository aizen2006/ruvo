import type { Budgets, DatasetContract, Recipe, RunMetrics, Stage, WorkflowIR } from "@repo/contracts";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import type { Decider } from "../decide/decider";
import type { Fetcher } from "../fetch/fetcher";
import type { LlmClient } from "../llm/client";
import { runs } from "../db/schema";
import { logger, type Logger } from "../libs/logger";
import { createBudget, type Budget, type BudgetKey } from "./budget";
import { createEventBus, nextEventSeq, type EmitInput } from "./eventBus";
import { createMetrics, type Metrics } from "./metrics";

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
  log: Logger;
  /** Recipe repairs made during the run; they become a new workflow version when it ends. */
  repairs: RepairNote[];
  /** Pages a paginated list source may read (the run mode's cap); 1 when unset. */
  maxListPages?: number;
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

export interface OwnedRunContext extends RunContext {
  /** Persists the latest metrics snapshot. Called periodically and on dispose. */
  saveMetrics(): Promise<void>;
  /** Flushes events and metrics; call once when the run ends. */
  dispose(): Promise<void>;
}

/** What running out of each budget means for the rest of the run. */
const BUDGET_MESSAGE: Record<BudgetKey, (limit: number) => string> = {
  pages: (n) => `Page budget used up (${n} pages); remaining pages are skipped`,
  browserPages: (n) => `Browser budget used up (${n} pages); pages that need a browser are skipped`,
  llmCalls: (n) => `AI call budget used up (${n} calls); remaining steps continue without AI`,
  searches: (n) => `Search budget used up (${n} searches); no more sources are looked for`,
};

export async function createRunContext(args: {
  runId: string;
  signal: AbortSignal;
  contract: DatasetContract;
  ir: WorkflowIR;
  fetcher: Fetcher;
  llm: LlmClient;
  decider: Decider;
  initialMetrics?: RunMetrics;
  budgets?: Budgets;
  maxListPages?: number;
}): Promise<OwnedRunContext> {
  const { runId } = args;
  const bus = createEventBus(runId, { startSeq: await nextEventSeq(runId) });
  const metrics = createMetrics(args.initialMetrics);
  const saveMetrics = async () => {
    await db.update(runs).set({ metrics: metrics.snapshot() }).where(eq(runs.id, runId));
  };
  let currentStage: Stage = "collecting";
  const metricsTimer = setInterval(() => void saveMetrics().catch(() => {}), 1000);

  return {
    runId,
    signal: args.signal,
    contract: args.contract,
    ir: args.ir,
    budget: createBudget(args.budgets ?? args.ir.budgets, (key, limit) =>
      bus.emit({ stage: currentStage, type: "budget.exhausted", level: "warn", message: BUDGET_MESSAGE[key](limit), data: { key, limit } }),
    ),
    metrics,
    fetcher: args.fetcher,
    llm: args.llm,
    decider: args.decider,
    log: logger.child({ runId }),
    repairs: [],
    maxListPages: args.maxListPages,
    emit: bus.emit,
    async setStage(stage) {
      currentStage = stage;
      await db.update(runs).set({ stage }).where(eq(runs.id, runId));
      bus.emit({ stage, type: "stage.started", message: `Stage: ${stage}` });
    },
    saveMetrics,
    async dispose() {
      clearInterval(metricsTimer);
      await Promise.all([bus.close(), saveMetrics()]);
    },
  };
}
