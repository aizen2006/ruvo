import type { DatasetContract, PlanDraft } from "@repo/contracts";
import { desc, gte, sql } from "drizzle-orm";
import { db } from "../db/client";
import { workflowMemory } from "../db/schema";
import type { Logger } from "../libs/logger";

/**
 * Workflow memory: plans that produced good datasets, indexed by what they were asked for.
 * A new request that means the same thing ("AI backend jobs, remote" vs "remote backend
 * roles at AI companies") reuses the stored plan instead of calling the planner.
 */

/**
 * Minimum trigram similarity (pg_trgm) between contract summaries for a plan to be reused.
 * Measured on 27 real requests: a paraphrase scored 0.75, an edited contract for the same prompt
 * 0.73, and related but different requests (another company, other roles) at most 0.64.
 */
export const REUSE_MIN_SCORE = 0.7;
/** A plan is only remembered (and reused) if its run produced at least this many valid records. */
export const REUSE_MIN_VALID = 20;

export interface Recalled {
  workflowId: string;
  runId: string;
  score: number;
  draft: PlanDraft;
}

export interface WorkflowMemory {
  /** The best stored plan for a contract, or null. Never throws. */
  recall(contract: DatasetContract): Promise<Recalled | null>;
  /** Stores a plan after a good run. Never throws. */
  remember(input: { workflowId: string; runId: string; contract: DatasetContract; draft: PlanDraft; validRecords: number }): Promise<boolean>;
}

/**
 * What a contract asks for, in a stable canonical form: the parts that decide which plan
 * fits (entity, fields, criteria, assumptions, source hints), not the prompt's wording.
 */
export function contractSummary(c: DatasetContract): string {
  const sorted = (xs: string[]) => [...xs].map((x) => x.toLowerCase()).sort();
  return [
    `entity: ${c.entity} (${c.entityDescription})`,
    `fields: ${sorted(c.fields.map((f) => `${f.name}${f.required ? "*" : ""}`)).join(", ")}`,
    `criteria: ${sorted(c.criteria.map((k) => `${k.strength} ${k.kind} ${k.label}: ${sorted(k.values).join("/")}`)).join("; ")}`,
    `assumptions: ${sorted(c.assumptions.map((a) => a.interpretation)).join("; ")}`,
    `companies: ${sorted(c.sourceHints.companies).join(", ") || "any"}; tags: ${sorted(c.sourceHints.companyTags).join(", ") || "any"}`,
    `excluded: ${sorted(c.sourceHints.excludeCompanies).join(", ") || "none"}; urls: ${sorted(c.sourceHints.urls).join(", ") || "none"}`,
    `community boards: ${c.sourceHints.includeCommunityBoards ? "yes" : "no"}`,
  ].join("\n");
}

export function createWorkflowMemory(deps: { log: Logger }): WorkflowMemory {
  return {
    async recall(contract) {
      try {
        const score = sql<number>`similarity(${workflowMemory.summary}, ${contractSummary(contract)})`.mapWith(Number);
        const [best] = await db
          .select({ workflowId: workflowMemory.workflowId, runId: workflowMemory.runId, draft: workflowMemory.planDraft, score })
          .from(workflowMemory)
          .where(gte(workflowMemory.validRecords, REUSE_MIN_VALID))
          .orderBy(desc(score))
          .limit(1);
        return best && best.score >= REUSE_MIN_SCORE ? best : null;
      } catch (err) {
        deps.log.debug("Workflow memory lookup skipped", { error: (err as Error).message });
        return null;
      }
    },

    async remember({ workflowId, runId, contract, draft, validRecords }) {
      if (validRecords < REUSE_MIN_VALID) return false;
      try {
        const row = { runId, summary: contractSummary(contract), validRecords, planDraft: draft, rememberedAt: new Date() };
        await db.insert(workflowMemory).values({ workflowId, ...row }).onConflictDoUpdate({ target: workflowMemory.workflowId, set: row });
        return true;
      } catch (err) {
        deps.log.debug("Workflow memory upsert skipped", { error: (err as Error).message });
        return false;
      }
    },
  };
}
