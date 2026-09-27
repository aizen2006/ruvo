import type { DecisionSummary } from "@repo/contracts";
import { desc, eq } from "drizzle-orm";
import { db } from "../client";
import { decisions } from "../schema";

type Tier = keyof DecisionSummary["byTier"];
const emptyTiers = (): Record<Tier, number> => ({ RULES: 0, DECIDER: 0, LLM: 0, DEFAULT: 0 });

/** Summarises every decision a run made, by tier and task, with recent examples. */
export async function getDecisionSummary(runId: string): Promise<DecisionSummary> {
  const rows = await db.select().from(decisions).where(eq(decisions.runId, runId)).orderBy(desc(decisions.createdAt));

  const byTier = emptyTiers();
  const tasks = new Map<string, { total: number; byTier: Record<Tier, number> }>();
  let compared = 0;
  let agreed = 0;
  for (const row of rows) {
    byTier[row.decidedBy]++;
    const task = tasks.get(row.task) ?? { total: 0, byTier: emptyTiers() };
    task.total++;
    task.byTier[row.decidedBy]++;
    tasks.set(row.task, task);

    const shadow = row.shadow as { label: string } | null;
    if (row.decidedBy === "LLM" && shadow) {
      compared++;
      if (shadow.label === row.label) agreed++;
    }
  }

  // Model-decided examples first: they are the interesting ones.
  const interesting = [...rows.filter((r) => r.decidedBy !== "RULES"), ...rows.filter((r) => r.decidedBy === "RULES")];
  return {
    total: rows.length,
    byTier,
    byTask: [...tasks.entries()].map(([task, t]) => ({ task, ...t })),
    agreement: { compared, agreed },
    providerModel: rows.find((r) => r.providerModel)?.providerModel ?? null,
    samples: interesting.slice(0, 25).map((r) => ({
      task: r.task,
      subject: r.subject,
      question: ((r.state as { question?: string } | null)?.question as string | undefined) ?? null,
      label: r.label,
      confidence: r.confidence,
      decidedBy: r.decidedBy,
      shadow: (r.shadow as { label: string; confidence: number } | null) ?? null,
    })),
  };
}
