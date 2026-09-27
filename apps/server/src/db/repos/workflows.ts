import type { DatasetContract, PlanDraft, WorkflowIR } from "@repo/contracts";
import { desc, eq, max } from "drizzle-orm";
import { db } from "../client";
import { datasetContracts, runs, workflows } from "../schema";

/** Contract and workflow versions. Each edit or replan adds a new version; nothing is overwritten. */

export async function saveContract(input: {
  requestId: string;
  contract: DatasetContract;
  editedBy: "llm" | "user" | "template";
  model?: string | null;
}) {
  const [latest] = await db
    .select({ version: max(datasetContracts.version) })
    .from(datasetContracts)
    .where(eq(datasetContracts.requestId, input.requestId));
  const [row] = await db
    .insert(datasetContracts)
    .values({ ...input, model: input.model ?? null, version: (latest?.version ?? 0) + 1 })
    .returning();
  return row!;
}

export async function saveWorkflow(input: {
  contractId: string;
  ir: WorkflowIR;
  planDraft?: PlanDraft | null;
  parentWorkflowId?: string | null;
  reusedFromWorkflowId?: string | null;
}) {
  const version = (input.ir.provenance.parentVersion ?? 0) + 1;
  const [row] = await db
    .insert(workflows)
    .values({
      contractId: input.contractId,
      ir: input.ir,
      planDraft: input.planDraft ?? null,
      parentWorkflowId: input.parentWorkflowId ?? null,
      reusedFromWorkflowId: input.reusedFromWorkflowId ?? null,
      version,
    })
    .returning();
  return row!;
}

export async function attachWorkflow(runId: string, workflowId: string) {
  await db.update(runs).set({ workflowId }).where(eq(runs.id, runId));
}

/** The contract and IR a run executes, or null if it hasn't been planned yet. */
export async function loadRunWorkflow(runId: string) {
  const [row] = await db
    .select({ workflowId: workflows.id, ir: workflows.ir, contract: datasetContracts.contract })
    .from(runs)
    .innerJoin(workflows, eq(runs.workflowId, workflows.id))
    .innerJoin(datasetContracts, eq(workflows.contractId, datasetContracts.id))
    .where(eq(runs.id, runId))
    .orderBy(desc(workflows.version))
    .limit(1);
  return row ?? null;
}
