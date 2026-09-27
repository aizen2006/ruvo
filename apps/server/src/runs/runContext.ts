import type { Budgets, DatasetContract, RunMetrics, Stage, WorkflowIR } from "@repo/contracts";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { runs } from "../db/schema";
import { logger, type Logger } from "../libs/logger";
import { createBudget, type Budget } from "./budget";
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
  log: Logger;
  emit(event: EmitInput): void;
  /** Moves the run to a new user-facing stage (persisted and announced). */
  setStage(stage: Stage): Promise<void>;
}

export interface OwnedRunContext extends RunContext {
  /** Persists the latest metrics snapshot. Called periodically and on dispose. */
  saveMetrics(): Promise<void>;
  /** Flushes events and metrics; call once when the run ends. */
  dispose(): Promise<void>;
}

export async function createRunContext(args: {
  runId: string;
  signal: AbortSignal;
  contract: DatasetContract;
  ir: WorkflowIR;
  initialMetrics?: RunMetrics;
  budgets?: Budgets;
}): Promise<OwnedRunContext> {
  const { runId } = args;
  const bus = createEventBus(runId, { startSeq: await nextEventSeq(runId) });
  const metrics = createMetrics(args.initialMetrics);
  const saveMetrics = async () => {
    await db.update(runs).set({ metrics: metrics.snapshot() }).where(eq(runs.id, runId));
  };
  const metricsTimer = setInterval(() => void saveMetrics().catch(() => {}), 1000);

  return {
    runId,
    signal: args.signal,
    contract: args.contract,
    ir: args.ir,
    budget: createBudget(args.budgets ?? args.ir.budgets),
    metrics,
    log: logger.child({ runId }),
    emit: bus.emit,
    async setStage(stage) {
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
