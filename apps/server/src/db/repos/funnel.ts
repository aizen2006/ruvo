import type { RunFunnel } from "@repo/contracts";
import { and, count, eq, isNull, ne, sql, type SQL } from "drizzle-orm";
import { db } from "../client";
import { records, runs, workflows } from "../schema";

const tally = (where: SQL | undefined) => sql`count(*) filter (where ${where})`.mapWith(Number);

/**
 * A run's leads funnel, counted from what it already records: searches and sources from its
 * workflow, raw records from its metrics, and the rest from its stored records.
 */
export async function getRunFunnel(runId: string, rawRecords: number): Promise<RunFunnel> {
  const [[plan], [counts]] = await Promise.all([
    db
      .select({
        // A skipped or failed search carries an error and found nothing.
        searched: sql`(select count(*) from jsonb_array_elements(coalesce(${workflows.ir}->'search'->'queries', '[]')) q where q->>'error' is null)`.mapWith(Number),
        sources: sql`jsonb_array_length(${workflows.ir}->'sources')`.mapWith(Number),
      })
      .from(runs)
      .innerJoin(workflows, eq(runs.workflowId, workflows.id))
      .where(eq(runs.id, runId)),
    db
      .select({
        stored: count(),
        qualified: tally(ne(records.status, "invalid")),
        complete: tally(eq(records.status, "valid")),
        ready: tally(and(eq(records.status, "valid"), isNull(records.duplicateOf))),
      })
      .from(records)
      .where(eq(records.runId, runId)),
  ]);
  const { stored, qualified, complete, ready } = counts!;
  // Raw records are counted at the prefilter step, which older plans lacked; whatever was stored was collected.
  const collected = Math.max(rawRecords, stored);

  const losses = [
    { step: "qualified", lost: stored - qualified, of: collected },
    { step: "complete", lost: qualified - complete, of: qualified },
    { step: "ready", lost: complete - ready, of: complete },
  ] as const;
  const worst = losses.reduce((a, b) => (b.lost > a.lost ? b : a));
  const top = worst.lost > 0 && worst.step !== "ready" ? await topReason(runId, worst.step) : null;

  return {
    searched: plan?.searched ?? 0,
    sources: plan?.sources ?? 0,
    collected,
    qualified,
    complete,
    ready,
    biggestLoss: worst.lost > 0 ? { step: worst.step, count: top?.count ?? worst.lost, of: worst.of, reason: top?.reason ?? null } : null,
  };
}

/** The most common reason records were set aside at a step: a failed hard criterion, or a missing required field. */
async function topReason(runId: string, step: "qualified" | "complete") {
  const [top] = await db.execute<{ reason: string; count: number }>(
    step === "qualified"
      ? sql`select s->>'label' as reason, count(*)::int as count from ${records}, jsonb_array_elements(${records.signals}) s
          where ${records.runId} = ${runId} and ${records.status} = 'invalid' and s->>'strength' = 'hard' and s->>'passed' = 'false'
          group by 1 order by 2 desc, 1 limit 1`
      : // The validate step names them: "Missing required fields: salary, remote".
        sql`select f as reason, count(*)::int as count from ${records}, jsonb_array_elements_text(${records.rejectReasons}) r,
            unnest(string_to_array(substring(r from '^Missing required fields?: (.*)$'), ', ')) f
          where ${records.runId} = ${runId} and ${records.status} = 'incomplete'
          group by 1 order by 2 desc, 1 limit 1`,
  );
  return top ?? null;
}
