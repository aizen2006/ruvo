import { isSensitive, type DatasetContract, type Stage, type WorkflowIR } from "@repo/contracts";
import { compileRequirement } from "../compile/requirementCompiler";
import { env } from "../config/env";
import { createBudget, createMetrics, type EmitInput } from "../core/run";
import type { ClaimedRun } from "../db/queue";
import { getRequestPrompt, setRunStage } from "../db/repos/runs";
import { attachWorkflow, getRunWorkflow, saveContract, saveWorkflow } from "../db/repos/workflows";
import { emitSearches, searchMore, searchRounds } from "../discover/rounds";
import { packOf } from "../domains";
import { scopeLlm, type LlmClient } from "../llm/client";
import type { WorkflowMemory } from "../memory/workflowMemory";
import { discoverSources, foundCandidate } from "../plan/discovery";
import { planForContract } from "../plan/planner";
import type { WebDiscovery, WebSearch } from "../plan/webDiscovery";
import { recompileWorkflow } from "./editContract";
import { createEventBus, nextEventSeq, type EventBus } from "./eventBus";
import { budgetsForMode, runModels, searchResultsPerQuery } from "./modes";
import type { RunPreparer } from "./worker";

/**
 * Preparation phase of a run: prompt → Dataset Contract → candidate sources → WorkflowIR.
 * Ends in review (awaiting_approval) unless the run was created with autoStart (see afterPreparing).
 * With `webSearch` (SearXNG, Firecrawl or both configured), sources are also found by searching the web.
 */
export const createPreparer = ({ llm: baseLlm, memory, webSearch: web = null }: { llm: LlmClient; memory?: WorkflowMemory; webSearch?: WebSearch | null }): RunPreparer => async (run, signal) => {
  const bus = createEventBus(run.id, { startSeq: await nextEventSeq(run.id) });
  // Compile and plan with the run's models, and count what they cost towards the run.
  const llm = scopeLlm(baseLlm, { models: runModels(run, env), runId: run.id });
  const stage = async (s: Stage, event: Omit<EmitInput, "stage">) => {
    await setRunStage(run.id, s);
    bus.emit({ ...event, stage: s });
  };

  try {
    // A queued run that already has a workflow is a "find more" follow-up (see rerunRun).
    if (run.workflowId) return await prepareMore(run, { llm, web, bus, stage, signal });

    await stage("understanding", { type: "compile.started", message: "Understanding the request" });
    const compiled = await compileRequirement(llm, await getRequestPrompt(run.requestId), signal);
    const contract = compiled.contract;
    const contractRow = await saveContract({ requestId: run.requestId, contract, editedBy: "llm", model: compiled.model });
    bus.emit({
      stage: "understanding",
      type: "compile.completed",
      message: `Dataset contract: ${contract.fields.length} fields, ${contract.criteria.length} criteria, ${contract.assumptions.length} assumptions`,
      data: { warnings: compiled.warnings },
    });

    await stage("planning", { type: "discovery.started", message: "Finding sources" });
    const candidates = await discoverSources(contract, { userAgent: env.USER_AGENT, emit: (event) => bus.emit({ ...event, stage: "planning" }) });
    const caps = budgetsForMode(run.mode, env, contract.maxRecords);

    // Every request searches the web when it can: linked pages and the sources its domain knows are read too.
    let search: WebDiscovery | null = null;
    if (web) {
      await stage("discovering", { type: "discovery.search_started", message: `Searching the web (up to ${caps.maxSearches} searches)` });
      const scope = { signal, budget: createBudget(caps), metrics: createMetrics() };
      search = await searchRounds(contract, {
        web,
        llm,
        mode: run.mode,
        runId: run.id,
        scope,
        resultsPerQuery: searchResultsPerQuery(run.mode),
        userAgent: env.USER_AGENT,
        planned: candidates,
        emit: bus.emit,
      });
      const known = new Set(candidates.map((c) => c.ref));
      const added = search.sources.filter((s) => !known.has(s.ref)).map(foundCandidate);
      candidates.push(...added);
      await stage("planning", {
        type: "discovery.search_completed",
        message: `Web search found ${added.length} source${added.length === 1 ? "" : "s"} RUVO may read`,
      });
    }

    bus.emit({
      stage: "planning",
      type: "discovery.completed",
      level: candidates.length ? "info" : "warn",
      message: candidates.length ? `${candidates.length} candidate sources` : noSourcesMessage(contract, search),
      data: { candidates: candidates.map((c) => c.ref) },
    });

    const remembered = (await memory?.recall(contract)) ?? null;
    const { ir, draft, reused } = await planForContract(llm, contract, candidates, caps, signal, remembered);
    if (search) ir.search = { queries: search.searches, sources: search.sources };
    const workflow = await saveWorkflow({ contractId: contractRow.id, ir, planDraft: draft, reusedFromWorkflowId: reused?.workflowId ?? null });
    if (reused) {
      bus.emit({
        stage: "planning",
        type: "plan.reused",
        message: `Reused the plan of an earlier run for a similar request (similarity ${reused.score.toFixed(2)}); no planner call needed`,
        data: { runId: reused.runId, workflowId: reused.workflowId, score: reused.score },
      });
    }
    await attachWorkflow(run.id, workflow.id);
    bus.emit({
      stage: "planning",
      type: "plan.completed",
      message: `Workflow planned (${ir.provenance.plannedBy}): ${ir.sources.length} sources`,
      data: { plannedBy: ir.provenance.plannedBy, warnings: ir.provenance.warnings },
    });

    return afterPreparing(run, contract, ir);
  } finally {
    await bus.close();
  }
};

/**
 * Where a prepared run goes: an auto-started one straight to collecting, unless it has nothing to
 * collect from (the user adds a page in review) or filters on sensitive attributes (the user confirms its purpose).
 */
const afterPreparing = (run: ClaimedRun, contract: DatasetContract, ir: WorkflowIR) =>
  run.autoStart && ir.sources.length > 0 && !isSensitive(contract) ? "queued_run" : "awaiting_approval";

type StageFn = (s: Stage, event: Omit<EmitInput, "stage">) => Promise<void>;

/**
 * Prepares a "find more" run: searches with queries not tried yet and adds the sources found to
 * the previous workflow as a new version. Earlier sources stay and replay from cache, so the
 * run's diff against the previous run shows the new rows.
 */
async function prepareMore(
  run: ClaimedRun,
  { llm, web, bus, stage, signal }: { llm: LlmClient; web: WebSearch | null; bus: EventBus; stage: StageFn; signal: AbortSignal },
) {
  if (!web) throw new Error("Finding more needs web search, which is not set up (SEARXNG_URL or FIRECRAWL_API_KEY)");
  const current = await getRunWorkflow(run.id);
  const { contract, ir } = current;

  await stage("discovering", { type: "discovery.search_started", message: "Looking for more: thinking of new searches" });
  const scope = { signal, budget: createBudget(budgetsForMode(run.mode, env, contract.maxRecords)), metrics: createMetrics() };
  // One round like a run's own extra rounds (see moreLeads), so a later round of the same request.
  const more = await searchMore(contract, ir, {
    web,
    llm,
    mode: run.mode,
    runId: run.id,
    scope,
    resultsPerQuery: searchResultsPerQuery(run.mode),
    userAgent: env.USER_AGENT,
    round: 2,
  });
  if (more.queries.length === 0) throw new Error("Could not think of new searches for this request");
  emitSearches(bus.emit, more.searches);

  const { ir: next } = await recompileWorkflow(run.id, { current, contract, contractId: current.contractId, mode: run.mode, search: more.search, plannedBy: "find_more" });
  const added = next.sources.length - ir.sources.length;
  await stage("planning", {
    type: "plan.completed",
    level: added > 0 ? "info" : "warn",
    message: added > 0 ? `Found ${added} new source${added === 1 ? "" : "s"}, ${next.sources.length} in all` : "No new sources found; collecting from the earlier ones again",
  });
  return afterPreparing(run, contract, next);
}

function noSourcesMessage(contract: DatasetContract, search: WebDiscovery | null): string {
  if (search) {
    const queries = search.searches.map((s) => `"${s.query}"`).join(", ");
    return `No sources found: searched the web for ${queries || "nothing"} and found no page RUVO may read. Add the address of a page that lists these records`;
  }
  // A domain with sources of its own found none that fit; any other needs a page to read.
  return packOf(contract).knownSources
    ? "No supported sources match this request"
    : "No page to read yet: add the address of a page that lists these records to the contract";
}
