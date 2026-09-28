import { loadRunWorkflow, saveRepairedWorkflow } from "../db/repos/workflows";
import { executeWorkflow } from "../execute/executor";
import { createRunContext, type RunContext } from "./runContext";
import { decider, fetcher, llm } from "./services";
import type { RunExecutor } from "./worker";

/** Execution phase of a run: runs its compiled WorkflowIR. */
export const runPipeline: RunExecutor = async (run, signal) => {
  const planned = await loadRunWorkflow(run.id);
  if (!planned) throw new Error("Run has no workflow; it must be prepared before it can execute");

  const ctx = await createRunContext({ runId: run.id, signal, contract: planned.contract, ir: planned.ir, fetcher, llm, decider });
  try {
    await executeWorkflow(ctx);
    await recordRepairs(ctx);
  } finally {
    await ctx.dispose();
  }
};

/** Turns recipe repairs made during the run into a new workflow version. */
export async function recordRepairs(ctx: Pick<RunContext, "runId" | "repairs" | "emit">) {
  if (ctx.repairs.length === 0) return;
  const notes = ctx.repairs.map(
    (r) => `Repaired recipe for ${r.host}: v${r.fromVersion} → v${r.toVersion} (${r.origin === "local_repair" ? "local selector fix" : "LLM rediscovery"}) after ${r.failure}`,
  );
  const saved = await saveRepairedWorkflow(ctx.runId, notes);
  ctx.emit({ stage: "done", type: "workflow.repaired", message: `Saved workflow v${saved.version} with ${notes.length} recipe repair${notes.length > 1 ? "s" : ""}`, data: { workflowId: saved.id, version: saved.version, notes } });
}
