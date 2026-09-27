import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "./client";
import { runs } from "./schema";

/**
 * Postgres-backed run queue. Approved runs sit in status `queued_run`; workers claim them
 * atomically with FOR UPDATE SKIP LOCKED, keep them alive with heartbeats, and runs whose
 * worker died are requeued (a re-attempt replays cheaply from the page and LLM caches).
 */

export type ClaimedRun = typeof runs.$inferSelect;
export type FinalStatus = "completed" | "failed" | "cancelled";

/** Atomically takes the oldest waiting run, or returns null when the queue is empty. */
export async function claimNextRun(workerId: string): Promise<ClaimedRun | null> {
  const oldestWaiting = db
    .select({ id: runs.id })
    .from(runs)
    .where(eq(runs.status, "queued_run"))
    .orderBy(runs.createdAt)
    .limit(1)
    .for("update", { skipLocked: true });

  const [run] = await db
    .update(runs)
    .set({
      status: "running",
      workerId,
      heartbeatAt: new Date(),
      attempt: sql`${runs.attempt} + 1`,
      startedAt: sql`coalesce(${runs.startedAt}, now())`,
    })
    .where(inArray(runs.id, oldestWaiting))
    .returning();

  return run ?? null;
}

/**
 * Refreshes the lease on a run. Returns null if this worker no longer owns it
 * (it was requeued or finished elsewhere), otherwise whether a cancel was requested.
 */
export async function heartbeat(runId: string, workerId: string): Promise<{ cancelRequested: boolean } | null> {
  const [row] = await db
    .update(runs)
    .set({ heartbeatAt: new Date() })
    .where(and(eq(runs.id, runId), eq(runs.workerId, workerId), eq(runs.status, "running")))
    .returning({ cancelRequested: runs.cancelRequested });
  return row ?? null;
}

/** Marks a run finished, but only if this worker still owns it. */
export async function finishRun(runId: string, workerId: string, status: FinalStatus, error?: string) {
  await db
    .update(runs)
    .set({ status, error: error ?? null, finishedAt: new Date(), stage: "done" })
    .where(and(eq(runs.id, runId), eq(runs.workerId, workerId), eq(runs.status, "running")));
}

/**
 * Recovers runs whose worker stopped heartbeating: requeues them, or fails them
 * once they have used up their attempts. Returns how many rows were affected.
 */
export async function recoverStaleRuns(opts: { staleMs: number; maxAttempts: number }) {
  const cutoff = new Date(Date.now() - opts.staleMs);
  const stale = and(eq(runs.status, "running"), lt(runs.heartbeatAt, cutoff));

  const requeued = await db
    .update(runs)
    .set({ status: "queued_run", workerId: null })
    .where(and(stale, lt(runs.attempt, opts.maxAttempts)))
    .returning({ id: runs.id });

  const failed = await db
    .update(runs)
    .set({ status: "failed", error: "Worker stopped responding too many times", finishedAt: new Date() })
    .where(and(stale, gte(runs.attempt, opts.maxAttempts)))
    .returning({ id: runs.id });

  return { requeued: requeued.length, failed: failed.length };
}

/** Returns an in-flight run to the queue immediately, e.g. on graceful worker shutdown. */
export async function releaseRun(runId: string, workerId: string) {
  await db
    .update(runs)
    .set({ status: "queued_run", workerId: null })
    .where(and(eq(runs.id, runId), eq(runs.workerId, workerId), eq(runs.status, "running")));
}
