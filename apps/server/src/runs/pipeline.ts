import { env } from "../config/env";
import type { ClaimedRun } from "../db/queue";
import { attachWorkflow, loadRunWorkflow, saveContract, saveWorkflow } from "../db/repos/workflows";
import { executeWorkflow } from "../execute/executor";
import { createFetcher } from "../fetch/fetcher";
import { DEMO_CONTRACT } from "../plan/demoContract";
import { listRegistry } from "../plan/registry";
import { buildTemplateIr } from "../plan/templates";
import { budgetsFromEnv } from "./budget";
import { createRunContext } from "./runContext";
import type { RunExecutor } from "./worker";

/** One fetcher per process, so robots.txt, rate limits and circuit breakers are shared across runs. */
const fetcher = createFetcher({ userAgent: env.USER_AGENT, cacheMode: env.FETCH_CACHE_MODE });

const TEMPLATE_TAGS = new Set(["ai_lab", "ai_infra", "devtools"]);

/** Entry point the worker calls for each claimed run. */
export const runPipeline: RunExecutor = async (run, signal) => {
  const planned = (await loadRunWorkflow(run.id)) ?? (await planWithTemplate(run));
  const ctx = await createRunContext({ runId: run.id, signal, contract: planned.contract, ir: planned.ir, fetcher });
  try {
    await executeWorkflow(ctx);
  } finally {
    await ctx.dispose();
  }
};

/**
 * Until the requirement compiler exists, runs execute the demo contract against the
 * registry's AI / infra / devtools companies. The provenance warning makes this visible.
 */
async function planWithTemplate(run: ClaimedRun) {
  const companies = (await listRegistry()).filter((c) => c.tags.some((t) => TEMPLATE_TAGS.has(t)));
  const ir = buildTemplateIr(DEMO_CONTRACT, companies, {
    budgets: budgetsFromEnv(env, DEMO_CONTRACT.maxRecords),
    maxItemsPerSource: 40,
    warnings: ["Template workflow: the prompt was not compiled (requirement compiler not enabled yet)"],
  });
  const contractRow = await saveContract({ requestId: run.requestId, contract: DEMO_CONTRACT, editedBy: "template" });
  const workflow = await saveWorkflow({ contractId: contractRow.id, ir });
  await attachWorkflow(run.id, workflow.id);
  return { workflowId: workflow.id, contract: DEMO_CONTRACT, ir };
}
