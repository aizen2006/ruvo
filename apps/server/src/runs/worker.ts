import {
  claimNextRun,
  completePreparation,
  finishRun,
  heartbeat,
  recoverStaleRuns,
  releaseRun,
  type ClaimedRun,
  type QueuePhase,
} from "../db/queue";
import { logger } from "../libs/logger";
import { appendEvent } from "./eventBus";

/** Executes one claimed run. Must stop promptly when `signal` aborts. */
export type RunExecutor = (run: ClaimedRun, signal: AbortSignal) => Promise<void>;

/** Compiles and plans a run; returns whether it waits for approval or runs straight away. */
export type RunPreparer = (run: ClaimedRun, signal: AbortSignal) => Promise<"awaiting_approval" | "queued_run">;

export interface WorkerOptions {
  execute: RunExecutor;
  /** Without a preparer the worker only picks up runs that are ready to execute. */
  prepare?: RunPreparer;
  workerId?: string;
  pollMs?: number;
  heartbeatMs?: number;
  /** A run is considered orphaned when its heartbeat is older than this. */
  staleMs?: number;
  maxAttempts?: number;
}

/** Reasons a run's AbortSignal can fire; carried as `signal.reason`. */
export const ABORT_CANCELLED = "cancelled";
export const ABORT_LOST_LEASE = "lost_lease";
export const ABORT_SHUTDOWN = "shutdown";

/**
 * Starts a polling worker loop. Returns a handle whose `stop()` resolves once the
 * current run (if any) has been aborted and the loop has exited.
 */
export function startWorker(opts: WorkerOptions) {
  const workerId = opts.workerId ?? `worker-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
  const pollMs = opts.pollMs ?? 1000;
  const heartbeatMs = opts.heartbeatMs ?? 5000;
  const staleMs = opts.staleMs ?? 30_000;
  const maxAttempts = opts.maxAttempts ?? 2;
  const phases: QueuePhase[] = opts.prepare ? ["queued", "queued_run"] : ["queued_run"];

  let stopped = false;
  let current: AbortController | null = null;
  let wake: (() => void) | null = null;

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });

  async function processRun(run: ClaimedRun) {
    const controller = new AbortController();
    current = controller;
    const preparing = run.status === "compiling";
    const log = logger.child({ runId: run.id, workerId, attempt: run.attempt, phase: preparing ? "prepare" : "execute" });
    const lifecycle = (type: string, message: string, level: "info" | "warn" | "error" = "info") =>
      appendEvent(run.id, { stage: run.stage, type, message, level }).catch((err) =>
        log.warn("Could not record lifecycle event", { type, error: String(err) }),
      );
    log.info("Run claimed");
    if (!preparing) await lifecycle("run.claimed", `Collection attempt ${run.attempt} started`);

    const beat = setInterval(async () => {
      try {
        const lease = await heartbeat(run.id, workerId);
        if (!lease) controller.abort(ABORT_LOST_LEASE);
        else if (lease.cancelRequested) controller.abort(ABORT_CANCELLED);
      } catch (err) {
        log.warn("Heartbeat failed", { error: String(err) });
      }
    }, heartbeatMs);

    try {
      if (preparing) {
        const next = await opts.prepare!(run, controller.signal);
        controller.signal.throwIfAborted();
        await completePreparation(run.id, workerId, next);
        log.info("Run prepared", { next });
      } else {
        await opts.execute(run, controller.signal);
        // An executor that returns quietly after an abort is still classified by the abort reason.
        controller.signal.throwIfAborted();
        await finishRun(run.id, workerId, "completed");
        await lifecycle("run.completed", "Run completed");
        log.info("Run completed");
      }
    } catch (err) {
      const reason = controller.signal.aborted ? controller.signal.reason : null;
      if (reason === ABORT_CANCELLED) {
        await finishRun(run.id, workerId, "cancelled");
        await lifecycle("run.cancelled", "Run cancelled by user", "warn");
        log.info("Run cancelled");
      } else if (reason === ABORT_SHUTDOWN) {
        // Hand the run straight back so a restarted worker resumes it without waiting.
        await releaseRun(run.id, workerId);
        log.warn("Run released on shutdown");
      } else if (reason === ABORT_LOST_LEASE) {
        log.warn("Run lease lost; another worker owns it now");
      } else {
        const message = err instanceof Error ? err.message : String(err);
        await finishRun(run.id, workerId, "failed", message);
        await lifecycle("run.failed", message, "error");
        log.error("Run failed", { error: message });
      }
    } finally {
      clearInterval(beat);
      current = null;
    }
  }

  const loop = (async () => {
    logger.info("Worker started", { workerId, phases });
    while (!stopped) {
      try {
        const recovered = await recoverStaleRuns({ staleMs, maxAttempts });
        if (recovered.requeued || recovered.failed) logger.warn("Recovered stale runs", recovered);

        const run = await claimNextRun(workerId, phases);
        if (run) await processRun(run);
        else await sleep(pollMs);
      } catch (err) {
        logger.error("Worker loop error", { error: String(err) });
        await sleep(pollMs);
      }
    }
    logger.info("Worker stopped", { workerId });
  })();

  return {
    workerId,
    async stop() {
      stopped = true;
      current?.abort(ABORT_SHUTDOWN);
      wake?.();
      await loop;
    },
  };
}
