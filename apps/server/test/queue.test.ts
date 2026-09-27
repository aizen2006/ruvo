import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { claimNextRun, heartbeat, recoverStaleRuns } from "../src/db/queue";
import { runs } from "../src/db/schema";
import { startWorker } from "../src/runs/worker";
import { getRun, insertRun, resetDb, waitFor } from "./helpers/db";

beforeEach(resetDb);

describe("run queue", () => {
  test("claims the oldest waiting run exactly once", async () => {
    const run = await insertRun();
    const claimed = await claimNextRun("w1");
    expect(claimed?.id).toBe(run.id);
    expect(claimed?.status).toBe("running");
    expect(claimed?.attempt).toBe(1);
    expect(await claimNextRun("w2")).toBeNull();
  });

  test("concurrent claimers never share a run", async () => {
    await insertRun();
    const results = await Promise.all(["a", "b", "c", "d", "e"].map((w) => claimNextRun(w)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  test("claims runs awaiting preparation as compiling, only for workers that prepare", async () => {
    const run = await insertRun({ status: "queued" });
    expect(await claimNextRun("executor-only", ["queued_run"])).toBeNull();
    expect((await claimNextRun("preparer"))?.status).toBe("compiling");
    expect((await getRun(run.id)).workerId).toBe("preparer");
  });

  test("stale preparation goes back to the preparation queue", async () => {
    const run = await insertRun({ status: "compiling", attempt: 1, heartbeatAt: new Date(Date.now() - 60_000), workerId: "dead" });
    await recoverStaleRuns({ staleMs: 30_000, maxAttempts: 2 });
    expect((await getRun(run.id)).status).toBe("queued");
  });

  test("ignores runs that are not approved yet", async () => {
    await insertRun({ status: "awaiting_approval" });
    expect(await claimNextRun("w1")).toBeNull();
  });

  test("heartbeat reports cancel requests and lost leases", async () => {
    const run = await insertRun();
    await claimNextRun("w1");
    expect(await heartbeat(run.id, "w1")).toEqual({ cancelRequested: false });

    await db.update(runs).set({ cancelRequested: true }).where(eq(runs.id, run.id));
    expect(await heartbeat(run.id, "w1")).toEqual({ cancelRequested: true });
    expect(await heartbeat(run.id, "someone-else")).toBeNull();
  });

  test("requeues stale runs, then fails them after max attempts", async () => {
    const old = new Date(Date.now() - 60_000);
    const retryable = await insertRun({ status: "running", attempt: 1, heartbeatAt: old, workerId: "dead" });
    const exhausted = await insertRun({ status: "running", attempt: 2, heartbeatAt: old, workerId: "dead" });

    expect(await recoverStaleRuns({ staleMs: 30_000, maxAttempts: 2 })).toEqual({ requeued: 1, failed: 1 });
    expect((await getRun(retryable.id)).status).toBe("queued_run");
    expect((await getRun(exhausted.id)).status).toBe("failed");
  });
});

describe("worker", () => {
  const fast = { pollMs: 20, heartbeatMs: 30 };

  test("completes a run when the executor succeeds", async () => {
    const run = await insertRun();
    const worker = startWorker({ ...fast, execute: async () => {} });
    await waitFor(() => getRun(run.id), (r) => r.status === "completed");
    await worker.stop();
  });

  test("records the error when the executor throws", async () => {
    const run = await insertRun();
    const worker = startWorker({
      ...fast,
      execute: async () => {
        throw new Error("boom");
      },
    });
    const done = await waitFor(() => getRun(run.id), (r) => r.status === "failed");
    expect(done.error).toBe("boom");
    await worker.stop();
  });

  test("cancels a running run when cancel is requested", async () => {
    const run = await insertRun();
    const worker = startWorker({
      ...fast,
      execute: (_run, signal) =>
        new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
    });
    await waitFor(() => getRun(run.id), (r) => r.status === "running");
    await db.update(runs).set({ cancelRequested: true }).where(eq(runs.id, run.id));
    await waitFor(() => getRun(run.id), (r) => r.status === "cancelled");
    await worker.stop();
  });

  test("releases the run back to the queue on shutdown", async () => {
    const run = await insertRun();
    const worker = startWorker({
      ...fast,
      execute: (_run, signal) =>
        new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
    });
    await waitFor(() => getRun(run.id), (r) => r.status === "running");
    await worker.stop();
    expect((await getRun(run.id)).status).toBe("queued_run");
  });
});
