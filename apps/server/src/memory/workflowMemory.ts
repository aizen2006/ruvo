import type { DatasetContract, PlanDraft } from "@repo/contracts";
import type { Logger } from "../libs/logger";
import type { Embed } from "./embeddings";
import type { VectorStore } from "./qdrant";

/**
 * Workflow memory: plans that produced good datasets, indexed by what they were asked for.
 * A new request that means the same thing ("AI backend jobs, remote" vs "remote backend
 * roles at AI companies") reuses the stored plan instead of calling the planner.
 */

export const MEMORY_COLLECTION = "workflow_memory";
/**
 * Minimum cosine similarity between contract summaries for a plan to be reused. Summaries share
 * their structure, so unrelated requests still score about 0.8 (measured: a paraphrase 0.98,
 * "frontend jobs in London" vs "remote AI backend jobs" 0.80).
 */
export const REUSE_MIN_SCORE = 0.9;
/** A plan is only remembered (and reused) if its run produced at least this many valid records. */
export const REUSE_MIN_VALID = 20;

export interface MemoryPayload {
  workflowId: string;
  runId: string;
  validRecords: number;
  planDraft: PlanDraft;
  summary: string;
  rememberedAt: string;
}

export interface Recalled {
  workflowId: string;
  runId: string;
  score: number;
  draft: PlanDraft;
}

export interface WorkflowMemory {
  /** The best stored plan for a contract, or null. Never throws. */
  recall(contract: DatasetContract, signal?: AbortSignal): Promise<Recalled | null>;
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

export function createWorkflowMemory(deps: { embed: Embed; store: VectorStore; log: Logger; collection?: string }): WorkflowMemory {
  const collection = deps.collection ?? MEMORY_COLLECTION;

  return {
    async recall(contract, signal) {
      try {
        const vector = await deps.embed(contractSummary(contract), signal);
        const [best] = await deps.store.search<MemoryPayload>(collection, vector, 1);
        if (!best || best.score < REUSE_MIN_SCORE || best.payload.validRecords < REUSE_MIN_VALID) return null;
        return { workflowId: best.payload.workflowId, runId: best.payload.runId, score: best.score, draft: best.payload.planDraft };
      } catch (err) {
        deps.log.debug("Workflow memory lookup skipped", { error: (err as Error).message });
        return null;
      }
    },

    async remember({ workflowId, runId, contract, draft, validRecords }) {
      if (validRecords < REUSE_MIN_VALID) return false;
      try {
        const summary = contractSummary(contract);
        const vector = await deps.embed(summary);
        await deps.store.ensureCollection(collection, vector.length);
        await deps.store.upsert<MemoryPayload>(collection, [
          { id: workflowId, vector, payload: { workflowId, runId, validRecords, planDraft: draft, summary, rememberedAt: new Date().toISOString() } },
        ]);
        return true;
      } catch (err) {
        deps.log.debug("Workflow memory upsert skipped", { error: (err as Error).message });
        return false;
      }
    },
  };
}
