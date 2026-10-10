import type { Budgets, DatasetContract, RunMetrics, Stage, WorkflowIR } from "@repo/contracts";
import { eq } from "drizzle-orm";
import { createBudget, createMetrics, type BudgetKey, type RunContext } from "../core/run";
import { db } from "../db/client";
import type { Decider } from "../decide/decider";
import type { Fetcher } from "../fetch/fetcher";
import type { ScraplingClient } from "../fetch/scrapling";
import type { LlmClient } from "../llm/client";
import { runs } from "../db/schema";
import { logger } from "../libs/logger";
import { createEventBus, nextEventSeq } from "./eventBus";

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
  scrapling?: ScraplingClient;
  initialMetrics?: RunMetrics;
  budgets?: Budgets;
  maxListPages?: number;
  branchConcurrency?: number;
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
    scrapling: args.scrapling,
    log: logger.child({ runId }),
    repairs: [],
    maxListPages: args.maxListPages,
    branchConcurrency: args.branchConcurrency,
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
