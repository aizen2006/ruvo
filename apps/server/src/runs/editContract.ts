import type { DatasetContract, PlanDraft, Provenance, RunMode, WorkflowIR } from "@repo/contracts";
import { eq } from "drizzle-orm";
import { normalizeContract } from "../compile/normalize";
import { env } from "../config/env";
import { db } from "../db/client";
import { getRequestPrompt } from "../db/repos/runs";
import { attachWorkflow, getRunWorkflow, saveContract, saveWorkflow } from "../db/repos/workflows";
import { runs } from "../db/schema";
import { conflict } from "../libs/errors";
import { discoverSources, foundCandidate } from "../plan/discovery";
import { compileIr, defaultSourcePlan } from "../plan/irCompiler";
import { listRegistry } from "../plan/registry";
import { appendEvent } from "./eventBus";
import { budgetsForMode } from "./modes";

/**
 * Applies a user's edit to a run's contract before it starts: the contract is normalized
 * and versioned, and the workflow is recompiled for it (see recompileWorkflow).
 * Sources found by web search are kept without searching again, except those in `removeSources`.
 */
export async function editRunContract(runId: string, edited: DatasetContract, removeSources: string[] = []) {
  const [run] = await db.select({ status: runs.status, requestId: runs.requestId, mode: runs.mode }).from(runs).where(eq(runs.id, runId));
  if (!run || run.status !== "awaiting_approval") throw conflict("The contract can only be edited while the run awaits approval");

  const current = await getRunWorkflow(runId);
  const { contract, warnings } = normalizeContract(edited, await getRequestPrompt(run.requestId));
  const contractRow = await saveContract({ requestId: run.requestId, contract, editedBy: "user" });

  const removed = new Set(removeSources);
  const search = current.ir.search && { ...current.ir.search, sources: current.ir.search.sources.filter((s) => !removed.has(s.ref)) };
  const { ir, workflow } = await recompileWorkflow(runId, {
    current,
    contract,
    contractId: contractRow.id,
    mode: run.mode,
    search,
    plannedBy: "user_edit",
    removed,
    warnings,
  });
  await appendEvent(runId, {
    stage: "planning",
    type: "contract.edited",
    message: `Contract edited; workflow recompiled as v${workflow.version} with ${ir.sources.length} sources`,
    data: { warnings: ir.provenance.warnings },
  });
  return { contract, ir, workflowId: workflow.id, version: workflow.version };
}

/**
 * Recompiles a run's workflow from its existing plan (no LLM call) as a new version and moves the
 * run onto it. Candidates are the registry's sources for the contract plus those web search found
 * (`search`); the planner's choices are kept for sources that are still candidates.
 */
export async function recompileWorkflow(
  runId: string,
  input: {
    current: Awaited<ReturnType<typeof getRunWorkflow>>;
    contract: DatasetContract;
    contractId: string;
    mode: RunMode;
    search: WorkflowIR["search"];
    plannedBy: Provenance["plannedBy"];
    removed?: Set<string>;
    warnings?: string[];
  },
) {
  const { current, contract, search, removed = new Set() } = input;
  const discovered = discoverSources(contract, await listRegistry()).candidates;
  const known = new Set(discovered.map((c) => c.ref));
  const candidates = [...discovered, ...(search?.sources ?? []).filter((s) => !known.has(s.ref)).map(foundCandidate)].filter(
    (c) => !removed.has(c.ref),
  );
  const draft = mergeDraft(current.planDraft, candidates.map((c) => c.ref), (ref) => defaultSourcePlan(candidates.find((c) => c.ref === ref)!));
  const ir = compileIr(contract, draft, candidates, {
    caps: budgetsForMode(input.mode, env, contract.maxRecords),
    provenance: { plannedBy: input.plannedBy, model: null, reusedFrom: null, parentVersion: current.version },
  });
  ir.provenance.warnings.unshift(...(input.warnings ?? []));
  if (search) ir.search = search;

  const workflow = await saveWorkflow({ contractId: input.contractId, ir, planDraft: draft, parentWorkflowId: current.workflowId });
  await attachWorkflow(runId, workflow.id);
  return { ir, workflow };
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
