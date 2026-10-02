import type { DatasetContract, SearchLog, Stage } from "@repo/contracts";
import { compileRequirement } from "../compile/requirementCompiler";
import { env } from "../config/env";
import type { ClaimedRun } from "../db/queue";
import { getRequestPrompt, setRunStage } from "../db/repos/runs";
import { attachWorkflow, getRunWorkflow, saveContract, saveWorkflow } from "../db/repos/workflows";
import { autoDetectCompanies } from "../plan/atsDetect";
import { discoverSources, foundCandidate } from "../plan/discovery";
import { scopeLlm, type LlmClient } from "../llm/client";
import type { WorkflowMemory } from "../memory/workflowMemory";
import { planForContract } from "../plan/planner";
import { listRegistry } from "../plan/registry";
import { addFoundSources, discoverFromSearch, moreSearchQueries, searchQueriesFor, type WebDiscovery, type WebSearch } from "../plan/webDiscovery";
import { createBudget } from "./budget";
import { recompileWorkflow } from "./editContract";
import { createEventBus, nextEventSeq, type EmitInput, type EventBus } from "./eventBus";
import { createMetrics } from "./metrics";
import { budgetsForMode, runModels, searchResultsPerQuery } from "./modes";
import { llm as sharedLlm, memory, webSearch } from "./services";
import type { RunPreparer } from "./worker";

/** Below this many known job boards, a job request also searches the web. */
const THIN_JOB_SOURCES = 3;

/**
 * Preparation phase of a run: prompt → Dataset Contract → candidate sources → WorkflowIR.
 * Ends in review (awaiting_approval) unless the run was created with autoStart.
 * With `web` (Firecrawl configured), sources are also found by searching the web.
 */
export const createPreparer = ({ llm: baseLlm, memory, web = null }: { llm: LlmClient; memory?: WorkflowMemory; web?: WebSearch | null }): RunPreparer => async (run, signal) => {
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
    let discovery = discoverSources(contract, await listRegistry());
    const caps = budgetsForMode(run.mode, env, contract.maxRecords);

    // Companies the user named that the registry doesn't know: look for their public boards.
    if (discovery.unmatchedCompanies.length) {
      const { found, missing } = await autoDetectCompanies(discovery.unmatchedCompanies, { userAgent: env.USER_AGENT });
      for (const { name, hit } of found) {
        bus.emit({ stage: "planning", type: "discovery.detected", message: `Found a ${hit.ats} job board for ${name} (${hit.jobCount} postings)` });
      }
      if (missing.length) {
        bus.emit({ stage: "planning", type: "discovery.not_found", level: "warn", message: `No public job board found for ${missing.join(", ")}` });
      }
      if (found.length) discovery = discoverSources(contract, await listRegistry());
    }

    let search: WebDiscovery | null = null;
    if (web && wantsSearch(contract, discovery.candidates.length)) {
      const queries = searchQueriesFor(contract);
      await stage("discovering", {
        type: "discovery.search_started",
        message: `Searching the web (${queries.length} ${queries.length === 1 ? "search" : "searches"})`,
      });
      const scope = { signal, budget: createBudget(caps), metrics: createMetrics() };
      search = await discoverFromSearch(contract, web, llm, { runId: run.id, scope, resultsPerQuery: searchResultsPerQuery(run.mode) });
      emitSearches(bus, search.searches);
      const known = new Set(discovery.candidates.map((c) => c.ref));
      const added = search.sources.filter((s) => !known.has(s.ref)).map(foundCandidate);
      discovery.candidates.push(...added);
      await stage("planning", {
        type: "discovery.search_completed",
        message: `Web search found ${added.length} source${added.length === 1 ? "" : "s"} RUVO may read`,
      });
    }

    bus.emit({
      stage: "planning",
      type: "discovery.completed",
      level: discovery.candidates.length ? "info" : "warn",
      message: discovery.candidates.length ? `${discovery.candidates.length} candidate sources` : noSourcesMessage(contract, search),
      data: { candidates: discovery.candidates.map((c) => c.ref), unmatchedCompanies: discovery.unmatchedCompanies },
    });

    const remembered = (await memory?.recall(contract)) ?? null;
    const { ir, draft, reused } = await planForContract(llm, contract, discovery.candidates, caps, signal, remembered);
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

    // With nothing to collect from, even an auto-started run stops for review so the user can add a page.
    return run.autoStart && ir.sources.length > 0 ? "queued_run" : "awaiting_approval";
  } finally {
    await bus.close();
  }
};

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
  if (!web) throw new Error("Finding more needs web search, which is not set up (FIRECRAWL_API_KEY)");
  const current = await getRunWorkflow(run.id);
  const { contract, ir } = current;

  await stage("discovering", { type: "discovery.search_started", message: "Looking for more: thinking of new searches" });
  const tried = ir.search?.queries.map((q) => q.query) ?? searchQueriesFor(contract);
  const queries = await moreSearchQueries(contract, tried, llm, signal);
  if (queries.length === 0) throw new Error("Could not think of new searches for this request");

  const scope = { signal, budget: createBudget(budgetsForMode(run.mode, env, contract.maxRecords)), metrics: createMetrics() };
  const withQueries = { ...contract, sourceHints: { ...contract.sourceHints, searchQueries: queries } };
  const found = await discoverFromSearch(withQueries, web, llm, { runId: run.id, scope, resultsPerQuery: searchResultsPerQuery(run.mode) });
  emitSearches(bus, found.searches);

  const search = { queries: [...(ir.search?.queries ?? []), ...found.searches], sources: addFoundSources(ir.search?.sources ?? [], found.sources) };
  const { ir: next } = await recompileWorkflow(run.id, { current, contract, contractId: current.contractId, mode: run.mode, search, plannedBy: "find_more" });
  const added = next.sources.length - ir.sources.length;
  await stage("planning", {
    type: "plan.completed",
    level: added > 0 ? "info" : "warn",
    message: added > 0 ? `Found ${added} new source${added === 1 ? "" : "s"}, ${next.sources.length} in all` : "No new sources found; collecting from the earlier ones again",
  });
  return run.autoStart && next.sources.length > 0 ? "queued_run" : "awaiting_approval";
}

function emitSearches(bus: EventBus, searches: SearchLog[]) {
  for (const s of searches) {
    bus.emit({
      stage: "discovering",
      type: "discovery.searched",
      level: s.error ? "warn" : "info",
      message: s.error
        ? `Could not search "${s.query}": ${s.error}`
        : `Searched "${s.query}": ${s.hits} results${s.cached ? " (saved from an earlier run)" : ""}`,
      data: s,
    });
  }
}

/**
 * Whether to search the web: always for other records, and for jobs only when the known boards
 * cover the request thinly. Linked pages with no written queries mean "read these pages".
 */
function wantsSearch(contract: DatasetContract, candidates: number): boolean {
  const { urls, searchQueries } = contract.sourceHints;
  if (urls.length > 0 && searchQueries.length === 0) return false;
  return contract.entity !== "job_posting" || (candidates < THIN_JOB_SOURCES && urls.length === 0);
}

function noSourcesMessage(contract: DatasetContract, search: WebDiscovery | null): string {
  if (search) {
    const queries = search.searches.map((s) => `"${s.query}"`).join(", ");
    return `No sources found: searched the web for ${queries || "nothing"} and found no page RUVO may read. Add the address of a page that lists these records`;
  }
  return contract.entity === "job_posting"
    ? "No supported sources match this request"
    : "No page to read yet: add the address of a page that lists these records to the contract";
}

export const prepareRun = createPreparer({ llm: sharedLlm, memory, web: webSearch });
