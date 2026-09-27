import type { DatasetContract, PlanDraft } from "@repo/contracts";
import { eq } from "drizzle-orm";
import { normalizeContract } from "../compile/normalize";
import { env } from "../config/env";
import { db } from "../db/client";
import { getRequestPrompt } from "../db/repos/runs";
import { attachWorkflow, getRunWorkflow, saveContract, saveWorkflow } from "../db/repos/workflows";
import { runs } from "../db/schema";
import { conflict } from "../libs/errors";
import { discoverSources } from "../plan/discovery";
import { compileIr, defaultSourcePlan } from "../plan/irCompiler";
import { listRegistry } from "../plan/registry";
import { budgetsFromEnv } from "./budget";
import { appendEvent } from "./eventBus";

/**
 * Applies a user's edit to a run's contract before it starts: the contract is normalized
 * and versioned, sources are re-discovered, and the IR is recompiled from the existing plan
 * (no LLM call), keeping the planner's choices for sources that are still candidates.
 */
export async function editRunContract(runId: string, edited: DatasetContract) {
  const [run] = await db.select({ status: runs.status, requestId: runs.requestId }).from(runs).where(eq(runs.id, runId));
  if (!run || run.status !== "awaiting_approval") throw conflict("The contract can only be edited while the run awaits approval");

  const current = await getRunWorkflow(runId);
  const { contract, warnings } = normalizeContract(edited, await getRequestPrompt(run.requestId));
  const contractRow = await saveContract({ requestId: run.requestId, contract, editedBy: "user" });

  const { candidates } = discoverSources(contract, await listRegistry());
  const draft = mergeDraft(current.planDraft, candidates.map((c) => c.ref), (ref) => defaultSourcePlan(candidates.find((c) => c.ref === ref)!));
  const ir = compileIr(contract, draft, candidates, {
    caps: budgetsFromEnv(env, contract.maxRecords),
    provenance: { plannedBy: "user_edit", model: null, reusedFrom: null, parentVersion: current.version },
  });
  ir.provenance.warnings.unshift(...warnings);

  const workflow = await saveWorkflow({ contractId: contractRow.id, ir, planDraft: draft, parentWorkflowId: current.workflowId });
  await attachWorkflow(runId, workflow.id);
  await appendEvent(runId, {
    stage: "planning",
    type: "contract.edited",
    message: `Contract edited; workflow recompiled as v${workflow.version} with ${ir.sources.length} sources`,
    data: { warnings: ir.provenance.warnings },
  });
  return { contract, ir, workflowId: workflow.id, version: workflow.version };
}

/** Keeps the previous plan's entries for refs that are still candidates and adds defaults for new ones. */
function mergeDraft(previous: PlanDraft | null, refs: string[], fallback: (ref: string) => PlanDraft["sources"][number]): PlanDraft {
  const planned = new Map((previous?.sources ?? []).map((s) => [s.ref, s]));
  return {
    sources: refs.map((ref) => planned.get(ref) ?? fallback(ref)),
    fieldStrategies: previous?.fieldStrategies ?? [],
    llmBudget: previous?.llmBudget ?? 0,
    rationale: previous?.rationale ?? "Recompiled after a contract edit",
  };
}
