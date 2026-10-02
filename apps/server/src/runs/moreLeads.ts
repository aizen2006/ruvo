import type { RunMode } from "@repo/contracts";
import { getRunWorkflow } from "../db/repos/workflows";
import type { FindMore } from "../execute/executor";
import { scopeLlm } from "../llm/client";
import { addFoundSources, discoverFromSearch, moreSearchQueries, searchQueriesFor, type WebSearch } from "../plan/webDiscovery";
import { recompileWorkflow } from "./editContract";
import { searchResultsPerQuery } from "./modes";

/**
 * Finds sources for another round of a run that is short of good leads, the way "find more"
 * does (see prepareMore): new searches from the worker model, given every query tried so far,
 * and only sources the workflow doesn't have yet. They are saved as a new workflow version, so
 * a re-run reads them too, and their branches are returned to run now. The AI calls and the
 * searches come out of the run's budgets.
 */
export const moreLeads = (web: WebSearch, mode: RunMode): FindMore => async (ctx, round) => {
  const say = (message: string, data?: unknown) => ctx.emit({ stage: "discovering", type: "more.searched", message: `Round ${round}: ${message}`, data });
  // A round needs one AI call to think of searches, and searches to run them.
  const spent = ctx.budget.left("llmCalls") < 1 ? "AI calls" : ctx.budget.left("searches") < 1 ? "searches" : null;
  if (spent) {
    say(`no ${spent} left in this run's budget`);
    return [];
  }

  const current = await getRunWorkflow(ctx.runId);
  const { contract, ir } = current;
  const llm = scopeLlm(ctx.llm, { run: ctx });
  const tried = ir.search?.queries.map((q) => q.query) ?? searchQueriesFor(contract);
  const queries = await moreSearchQueries(contract, tried, llm, ctx.signal);
  if (queries.length === 0) {
    say("no new searches to try");
    return [];
  }

  const withQueries = { ...contract, sourceHints: { ...contract.sourceHints, searchQueries: queries } };
  const found = await discoverFromSearch(withQueries, web, llm, { runId: ctx.runId, scope: ctx, resultsPerQuery: searchResultsPerQuery(mode) });
  const search = { queries: [...(ir.search?.queries ?? []), ...found.searches], sources: addFoundSources(ir.search?.sources ?? [], found.sources) };
  const { ir: next } = await recompileWorkflow(ctx.runId, { current, contract, contractId: current.contractId, mode, search, plannedBy: "more_leads" });

  const known = new Set(ir.sources.map((s) => s.ref));
  const added = next.sources.filter((s) => !known.has(s.ref));
  const searches = `${queries.length} new search${queries.length === 1 ? "" : "es"}`;
  say(added.length ? `${searches} found ${added.length} more source${added.length === 1 ? "" : "s"}` : `${searches} found no new sources`, {
    searches: found.searches,
    sources: added.map((s) => s.ref),
  });
  return added;
};
