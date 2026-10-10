import type { DatasetContract, FoundSource, RunMode, SearchLog, WorkflowIR } from "@repo/contracts";
import type { EmitInput } from "../core/run";
import { packOf } from "../domains";
import type { LlmClient } from "../llm/client";
import {
  addFoundSources,
  moreSearchQueries,
  runSearches,
  searchQueriesFor,
  sourcesFromHits,
  type WebDiscovery,
  type WebDiscoveryOptions,
  type WebSearch,
} from "../plan/webDiscovery";

/**
 * Searching the web for a run's sources, in rounds: up to MAX_SEARCH_ROUNDS while preparing it
 * (searchRounds), and one more when a run looks for more leads or the user asks to find more
 * (searchMore). A round's queries find pages to read (see sourcesFromHits); the contract's pack may
 * search on its own beside them and claim hits as sources of its own (see PackSearch): a job request
 * also searches the job-board platforms, and every posting found names its company's board.
 */

/** Search rounds while preparing a run, at most; each round after the first searches with new queries. */
const MAX_SEARCH_ROUNDS = 5;
/** Results read per search of the pack's own: a whole page of them, as each can be one more source at no extra search. */
const PACK_RESULTS = 20;

export interface RoundOptions extends WebDiscoveryOptions {
  web: WebSearch;
  llm: LlmClient;
  mode: RunMode;
  userAgent: string;
}

interface Round {
  /** New sources of the pack's own (e.g. job boards). */
  own: FoundSource[];
  /** Pages to read, whether seen before or not, so a profile found again can join its site's group. */
  pages: FoundSource[];
  searches: SearchLog[];
}

/** One round: the pack's own searches get at most half the searches left (rounded up), page searches the rest. */
async function searchRound(
  contract: DatasetContract,
  { web, llm, round, queries, seen, left, ...opts }: RoundOptions & { round: number; queries: string[]; seen: ReadonlySet<string>; left: number },
): Promise<Round> {
  const search = packOf(contract).search;
  const own = search && left > 0 ? search.queries(contract, queries, round) : [];
  const ownRun = await runSearches(own.slice(0, Math.ceil(opts.scope.budget.left("searches") / 2)), web.searcher, { ...opts, resultsPerQuery: PACK_RESULTS });
  const pageRun = await runSearches(queries.slice(0, opts.scope.budget.left("searches")), web.searcher, opts);
  const sources = search && left > 0 ? await search.sources(contract, [...ownRun.hits, ...pageRun.hits], { seen, max: left, userAgent: opts.userAgent }) : [];
  const pages = await sourcesFromHits(contract, search ? pageRun.hits.filter((h) => !search.recognize(h)) : pageRun.hits, web, llm, opts);
  return { own: sources, pages, searches: [...ownRun.searches, ...pageRun.searches] };
}

/**
 * Searches for a run being prepared, in rounds, until the search budget is spent, a round finds
 * nothing new or MAX_SEARCH_ROUNDS have run. The first round searches the contract's own queries;
 * later ones new queries from the worker model. Sources already `planned` count as seen.
 */
export async function searchRounds(
  contract: DatasetContract,
  { planned, emit, ...opts }: RoundOptions & { planned: Array<{ ref: string }>; emit: (event: EmitInput) => void },
): Promise<WebDiscovery> {
  const search = packOf(contract).search;
  let left = search?.maxNew[opts.mode] ?? 0;
  const found: WebDiscovery = { sources: [], searches: [] };
  let queries = searchQueriesFor(contract);
  for (let round = 1; round <= MAX_SEARCH_ROUNDS && opts.scope.budget.left("searches") > 0; round++) {
    if (round > 1) {
      queries = await moreSearchQueries(contract, found.searches.map((s) => s.query), opts.llm, opts.scope.signal).catch((err) => {
        if (opts.scope.signal.aborted) throw err;
        return [];
      });
      if (queries.length === 0) break;
    }
    const seen = new Set([...planned, ...found.sources].map((s) => s.ref));
    const { own, pages, searches } = await searchRound(contract, { ...opts, round, queries, seen, left });
    emitSearches(emit, searches);

    const fresh = [...own, ...pages.filter((s) => !seen.has(s.ref))];
    // Profiles found again join their site's group; new sources go last, so earlier rounds' are read first.
    found.sources = [...addFoundSources(found.sources, pages.filter((s) => seen.has(s.ref))), ...fresh];
    found.searches.push(...searches);
    left -= own.length;
    // "Search round 2: 4 more companies on Greenhouse and Lever, plus 2 more sources".
    const newPages = fresh.length - own.length;
    const told = [own.length > 0 && search?.summarize(own), newPages > 0 && `${newPages} more source${newPages === 1 ? "" : "s"}`].filter(Boolean);
    emit({ stage: "discovering", type: "discovery.search_round", message: `Search round ${round}: ${told.join(", plus ") || "nothing new"}` });
    if (fresh.length === 0) break;
  }
  return found;
}

/**
 * One more round for a planned workflow (more leads, find more): new searches from the worker
 * model, given every query tried so far, for sources the workflow doesn't have yet. Returns the
 * round's queries (none when the model thought of nothing new), its searches, and the workflow's
 * search record with what it found added.
 */
export async function searchMore(contract: DatasetContract, ir: WorkflowIR, { round, ...opts }: RoundOptions & { round: number }) {
  const tried = ir.search?.queries.map((q) => q.query) ?? searchQueriesFor(contract);
  const queries = await moreSearchQueries(contract, tried, opts.llm, opts.scope.signal);
  const before = { queries: ir.search?.queries ?? [], sources: ir.search?.sources ?? [] };
  if (queries.length === 0) return { queries, searches: [], search: before };

  const seen = new Set([...ir.sources, ...before.sources].map((s) => s.ref));
  const found = await searchRound(contract, { ...opts, round, queries, seen, left: packOf(contract).search?.maxNew[opts.mode] ?? 0 });
  const search = { queries: [...before.queries, ...found.searches], sources: addFoundSources(before.sources, [...found.own, ...found.pages]) };
  return { queries, searches: found.searches, search };
}

/** The run's log of searches: one line each, with what it found or why it failed. */
export function emitSearches(emit: (event: EmitInput) => void, searches: SearchLog[]) {
  for (const s of searches) {
    emit({
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
