import type { RunStatus } from "@repo/contracts";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "./client";
import { runs } from "./schema";

/**
 * Postgres-backed run queue. A run is claimed twice:
 *   queued      → compiling (→ planning) → awaiting_approval | queued_run   (preparation)
 *   queued_run  → running → completed | failed | cancelled                   (execution)
 * Workers claim atomically with FOR UPDATE SKIP LOCKED and hold the claim with heartbeats;
 * runs whose worker died go back to the queue (a re-attempt replays cheaply from caches).
 */

export type ClaimedRun = typeof runs.$inferSelect;
export type FinalStatus = "completed" | "failed" | "cancelled";

/** Statuses in which a worker owns the run and must heartbeat. */
const ACTIVE: RunStatus[] = ["compiling", "planning", "running"];

/** Where an active run goes back to if its worker disappears. */
const requeueStatus = sql`case when ${runs.status} = 'running' then 'queued_run' else 'queued' end`;

export type QueuePhase = "queued" | "queued_run";

/** Atomically takes the oldest run waiting in one of `phases`, or returns null when there is none. */
export async function claimNextRun(workerId: string, phases: QueuePhase[] = ["queued", "queued_run"]): Promise<ClaimedRun | null> {
  const oldestWaiting = db
    .select({ id: runs.id })
    .from(runs)
    .where(inArray(runs.status, phases))
    .orderBy(runs.createdAt)
    .limit(1)
    .for("update", { skipLocked: true });

  const [run] = await db
    .update(runs)
    .set({
      status: sql`case when ${runs.status} = 'queued' then 'compiling' else 'running' end`,
      workerId,
      heartbeatAt: new Date(),
      attempt: sql`${runs.attempt} + 1`,
      startedAt: sql`case when ${runs.status} = 'queued_run' then coalesce(${runs.startedAt}, now()) else ${runs.startedAt} end`,
    })
    .where(inArray(runs.id, oldestWaiting))
    .returning();

  return run ?? null;
}

const owned = (runId: string, workerId: string) =>
  and(eq(runs.id, runId), eq(runs.workerId, workerId), inArray(runs.status, ACTIVE));

/**
 * Refreshes the lease on a run. Returns null if this worker no longer owns it
 * (it was requeued or finished elsewhere), otherwise whether a cancel was requested.
 */
export async function heartbeat(runId: string, workerId: string): Promise<{ cancelRequested: boolean } | null> {
  const [row] = await db
    .update(runs)
    .set({ heartbeatAt: new Date() })
    .where(owned(runId, workerId))
    .returning({ cancelRequested: runs.cancelRequested });
  return row ?? null;
}

/** Ends preparation: hands the run to review or straight to the execution queue. */
export async function completePreparation(runId: string, workerId: string, next: "awaiting_approval" | "queued_run") {
  await db
    .update(runs)
    // Execution gets its own attempt budget.
    .set({ status: next, workerId: null, attempt: 0 })
    .where(owned(runId, workerId));
}

/**
 * Marks a run finished, but only if this worker still owns it. A failed or cancelled run keeps
 * the stage it stopped at, so the dashboard shows where it ended.
 */
export async function finishRun(runId: string, workerId: string, status: FinalStatus, error?: string) {
  await db
    .update(runs)
    .set({ status, error: error ?? null, finishedAt: new Date(), ...(status === "completed" ? { stage: "done" as const } : {}) })
    .where(owned(runId, workerId));
}

/** Returns an in-flight run to the queue immediately, e.g. on graceful worker shutdown. */
export async function releaseRun(runId: string, workerId: string) {
  await db
    .update(runs)
    .set({ status: requeueStatus, workerId: null })
    .where(owned(runId, workerId));
}

/**
 * Recovers runs whose worker stopped heartbeating: requeues them, or fails them
 * once they have used up their attempts. Returns how many rows were affected.
 */
export async function recoverStaleRuns(opts: { staleMs: number; maxAttempts: number }) {
  const cutoff = new Date(Date.now() - opts.staleMs);
  const stale = and(inArray(runs.status, ACTIVE), lt(runs.heartbeatAt, cutoff));

  const requeued = await db
    .update(runs)
    .set({ status: requeueStatus, workerId: null })
    .where(and(stale, lt(runs.attempt, opts.maxAttempts)))
    .returning({ id: runs.id });

  const failed = await db
    .update(runs)
    .set({ status: "failed", error: "Worker stopped responding too many times", finishedAt: new Date() })
    .where(and(stale, gte(runs.attempt, opts.maxAttempts)))
    .returning({ id: runs.id });

  return { requeued: requeued.length, failed: failed.length };
}
