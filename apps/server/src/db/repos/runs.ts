import {
  emptyMetrics,
  isTerminal,
  type RunDetail,
  type RunEvent,
  type RunStatus,
  type RunSummary,
  type Stage,
} from "@repo/contracts";
import { and, desc, eq, gt } from "drizzle-orm";
import { conflict, notFound } from "../../libs/errors";
import { db } from "../client";
import { datasetContracts, requests, runEvents, runs, workflows } from "../schema";

/** Data access for runs and their events. Routes call these; they never write SQL themselves. */

const iso = (d: Date | null) => (d ? d.toISOString() : null);

const summaryColumns = {
  id: runs.id,
  prompt: requests.prompt,
  requestId: runs.requestId,
  status: runs.status,
  stage: runs.stage,
  metrics: runs.metrics,
  workflowId: runs.workflowId,
  error: runs.error,
  createdAt: runs.createdAt,
  startedAt: runs.startedAt,
  finishedAt: runs.finishedAt,
};

/** Runs joined with their request prompt; shared by list and detail queries. */
const selectSummaries = () =>
  db.select(summaryColumns).from(runs).innerJoin(requests, eq(runs.requestId, requests.id));
type SummaryRow = Awaited<ReturnType<typeof selectSummaries>>[number];

function toSummary(row: SummaryRow): RunSummary {
  return {
    id: row.id,
    prompt: row.prompt,
    status: row.status,
    stage: row.stage,
    metrics: row.metrics,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
  };
}

/**
 * Creates a request and its run. With an idempotency key, a repeated call returns
 * the run created the first time instead of creating a duplicate.
 */
export async function createRun(input: { prompt: string; autoStart: boolean; idempotencyKey?: string }) {
  if (input.idempotencyKey) {
    const [existing] = await db
      .select({ runId: runs.id, status: runs.status })
      .from(requests)
      .innerJoin(runs, eq(runs.requestId, requests.id))
      .where(eq(requests.idempotencyKey, input.idempotencyKey))
      .limit(1);
    if (existing) return existing;
  }

  return db.transaction(async (tx) => {
    const [request] = await tx
      .insert(requests)
      .values({ prompt: input.prompt, idempotencyKey: input.idempotencyKey ?? null })
      .returning({ id: requests.id });
    // Every run starts in the preparation queue: a worker compiles and plans it next.
    const [run] = await tx
      .insert(runs)
      .values({ requestId: request!.id, status: "queued", stage: "understanding", autoStart: input.autoStart, metrics: emptyMetrics() })
      .returning({ runId: runs.id, status: runs.status });
    return run!;
  });
}

export async function listRuns(limit = 50): Promise<RunSummary[]> {
  const rows = await selectSummaries().orderBy(desc(runs.createdAt)).limit(limit);
  return rows.map(toSummary);
}

export async function getRunDetail(runId: string): Promise<RunDetail> {
  const [row] = await selectSummaries().where(eq(runs.id, runId));
  if (!row) throw notFound("Run");

  const [latestContract] = await db
    .select({ contract: datasetContracts.contract })
    .from(datasetContracts)
    .where(eq(datasetContracts.requestId, row.requestId))
    .orderBy(desc(datasetContracts.version))
    .limit(1);

  return { ...toSummary(row), contract: latestContract?.contract ?? null, workflowId: row.workflowId };
}

/** Approves a run that is waiting for review, handing it to the worker queue. */
export async function startRun(runId: string): Promise<RunStatus> {
  // A workflow with no sources would complete with nothing; ask for a source instead.
  const [planned] = await db
    .select({ ir: workflows.ir })
    .from(runs)
    .innerJoin(workflows, eq(runs.workflowId, workflows.id))
    .where(eq(runs.id, runId));
  if (planned && planned.ir.sources.length === 0) {
    throw conflict("This workflow has no sources yet. Add the address of a page that lists these records to the contract, then save.");
  }

  const [updated] = await db
    .update(runs)
    .set({ status: "queued_run" })
    .where(and(eq(runs.id, runId), eq(runs.status, "awaiting_approval")))
    .returning({ status: runs.status });
  if (updated) return updated.status;

  const { status } = await getStatus(runId);
  throw conflict(`Run cannot be started from status "${status}"`);
}

/**
 * Cancels a run. Running runs are flagged and stopped by their worker on the next
 * heartbeat; runs that haven't started are cancelled immediately.
 */
export async function requestCancel(runId: string): Promise<RunStatus> {
  const { status } = await getStatus(runId);
  if (isTerminal(status)) throw conflict(`Run already ${status}`);

  if (status === "running") {
    await db.update(runs).set({ cancelRequested: true }).where(eq(runs.id, runId));
    return status;
  }
  const [updated] = await db
    .update(runs)
    .set({ status: "cancelled", finishedAt: new Date(), stage: "done" })
    .where(and(eq(runs.id, runId), eq(runs.status, status)))
    .returning({ status: runs.status });
  // The status changed underneath us (e.g. a worker just claimed it); retry once with fresh state.
  return updated?.status ?? requestCancel(runId);
}

export async function listEvents(runId: string, after: number, limit = 500): Promise<RunEvent[]> {
  await getStatus(runId);
  const rows = await db
    .select()
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), gt(runEvents.seq, after)))
    .orderBy(runEvents.seq)
    .limit(limit);
  return rows.map((r) => ({
    seq: r.seq,
    ts: r.ts.toISOString(),
    stage: r.stage,
    type: r.type,
    level: r.level,
    sourceId: r.sourceId,
    message: r.message,
    data: r.data,
  }));
}

async function getStatus(runId: string) {
  const [row] = await db.select({ status: runs.status }).from(runs).where(eq(runs.id, runId));
  if (!row) throw notFound("Run");
  return row;
}

export async function setRunStage(runId: string, stage: Stage) {
  await db.update(runs).set({ stage }).where(eq(runs.id, runId));
}

export async function getRequestPrompt(requestId: string): Promise<string> {
  const [row] = await db.select({ prompt: requests.prompt }).from(requests).where(eq(requests.id, requestId));
  if (!row) throw notFound("Request");
  return row.prompt;
}

/**
 * Runs a finished run's workflow again as a new run, skipping compile and plan.
 * Recorded recipes and caches make the re-run cheap; comparing the two gives a diff.
 */
export async function rerunRun(runId: string) {
  const [source] = await db.select().from(runs).where(eq(runs.id, runId));
  if (!source) throw notFound("Run");
  if (!isTerminal(source.status)) throw conflict(`Run is still ${source.status}`);
  if (!source.workflowId) throw conflict("Run has no workflow to re-run");

  const [run] = await db
    .insert(runs)
    .values({
      requestId: source.requestId,
      workflowId: source.workflowId,
      status: "queued_run",
      stage: "collecting",
      autoStart: true,
      metrics: emptyMetrics(),
    })
    .returning({ runId: runs.id, status: runs.status });
  return run!;
}

export async function getQualityReport(runId: string) {
  const [row] = await db.select({ report: runs.qualityReport }).from(runs).where(eq(runs.id, runId));
  if (!row) throw notFound("Run");
  if (!row.report) throw notFound("Quality report (the run has not finished)");
  return row.report;
}

export async function getRunDiff(runId: string) {
  const [row] = await db.select({ diff: runs.diff }).from(runs).where(eq(runs.id, runId));
  if (!row) throw notFound("Run");
  if (!row.diff) throw notFound("Run diff (the run has not finished)");
  return row.diff;
}
