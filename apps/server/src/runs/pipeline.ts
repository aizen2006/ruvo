import { loadRunWorkflow } from "../db/repos/workflows";
import { executeWorkflow } from "../execute/executor";
import { createRunContext } from "./runContext";
import { fetcher, llm } from "./services";
import type { RunExecutor } from "./worker";

/** Execution phase of a run: runs its compiled WorkflowIR. */
export const runPipeline: RunExecutor = async (run, signal) => {
  const planned = await loadRunWorkflow(run.id);
  if (!planned) throw new Error("Run has no workflow; it must be prepared before it can execute");

  const ctx = await createRunContext({ runId: run.id, signal, contract: planned.contract, ir: planned.ir, fetcher, llm });
  try {
    await executeWorkflow(ctx);
  } finally {
    await ctx.dispose();
  }
};
