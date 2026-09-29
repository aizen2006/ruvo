import { emptyMetrics, type RunStatus } from "@repo/contracts";
import { eq, sql } from "drizzle-orm";
import { db } from "../../src/db/client";
import { requests, runs } from "../../src/db/schema";

/** Empties every table between tests (test database only; see test/setup.ts). */
export async function resetDb() {
  await db.execute(sql`
    truncate table evidence, records, run_events, runs, workflows, dataset_contracts, requests,
      pages, recipes, registry_companies, decisions, llm_calls, search_calls restart identity cascade`);
}

/** Inserts a request plus a run in the given status and returns the run row. */
export async function insertRun(overrides: Partial<typeof runs.$inferInsert> & { status?: RunStatus } = {}) {
  const [request] = await db.insert(requests).values({ prompt: "test prompt" }).returning();
  const [run] = await db
    .insert(runs)
    .values({ requestId: request!.id, status: "queued_run", stage: "understanding", metrics: emptyMetrics(), ...overrides })
    .returning();
  return run!;
}

export async function getRun(id: string) {
  const [run] = await db.select().from(runs).where(eq(runs.id, id));
  return run!;
}

/** Polls until `check` passes or the timeout elapses. */
export async function waitFor<T>(read: () => Promise<T>, check: (v: T) => boolean, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (check(value)) return value;
    if (Date.now() > deadline) throw new Error(`waitFor timed out; last value: ${JSON.stringify(value)}`);
    await Bun.sleep(25);
  }
}
