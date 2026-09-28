import type { FieldSpec, Recipe } from "@repo/contracts";
import { toPageState } from "../page/pageState";
import { discoverRecipe } from "../recipes/discover";
import { acceptanceFailure, replayRecipe, type ReplayResult } from "../recipes/replay";
import { saveRecipe } from "../recipes/store";
import type { RunContext } from "../runs/runContext";
import { classifyReplay } from "./classify";
import { chooseRepair } from "./policy";
import { relaxRecipe } from "./relax";

/** A page as fetched, and how it was fetched. */
export interface FetchedPage {
  html: string;
  url: string;
  finalUrl: string;
  /** Stored snapshot, referenced by evidence. */
  pageId: string | null;
  via: "http" | "browser";
}

export interface Repaired {
  recipe: Recipe;
  result: ReplayResult;
  /** The page the repaired recipe read (a retry may have fetched a new copy). */
  page: FetchedPage;
}

export interface RepairInput {
  page: FetchedPage;
  recipe: Recipe;
  result: ReplayResult;
  failure: { kind: "SELECTOR_MISS" | "PARTIAL_FILL"; detail: string };
  fields: FieldSpec[];
  /** Fetches the page again, bypassing the cache (used by RETRY and SWITCH_TO_BROWSER). */
  refetch(mode: "http" | "browser"): Promise<FetchedPage>;
}

/** At most this many repair actions per source per run (e.g. switch to browser, then fix selectors). */
const MAX_ACTIONS = 2;

/**
 * Repairs a recipe that no longer fits its page. Each round classifies the failure, asks
 * the repair policy for an action and applies it; any accepted fix is saved as recipe v+1
 * (with the broken version as parent) and noted on the run so the workflow gets a new
 * version. Returns null when the policy gives up.
 */
export async function repairRecipe(run: RunContext, input: RepairInput): Promise<Repaired | null> {
  let { page, result, failure } = input;
  const { recipe } = input;
  const host = new URL(page.url).host;

  for (let attempt = 1; attempt <= MAX_ACTIONS; attempt++) {
    const kind = classifyReplay(result, failure.kind, { textLength: toPageState(page.html, page.url).textLength });
    const { action, decidedBy } = await chooseRepair(run.decider, run, host, {
      failure: { kind, detail: failure.detail },
      via: page.via,
      itemsFound: result.itemCount,
      itemsExpected: null,
      attempt,
    });
    emit(run, "repair.decided", `${host}: ${kind} → ${action} (decided by ${decidedBy.toLowerCase()})`, { kind, action, decidedBy, attempt });

    switch (action) {
      case "STOP":
        return null;

      case "RETRY":
      case "SWITCH_TO_BROWSER": {
        page = await input.refetch(action === "RETRY" ? page.via : "browser");
        result = replayRecipe(page.html, page.url, recipe.def);
        const next = acceptanceFailure(result, recipe.acceptance);
        if (!next) {
          emit(run, "repair.applied", `${host}: recipe v${recipe.version} works again after ${action === "RETRY" ? "a retry" : "rendering in the browser"}`, { action });
          return { recipe, result, page };
        }
        failure = next;
        continue;
      }

      case "CHANGE_SELECTOR": {
        const local = localRepair(run, page, recipe, input.fields);
        if (local) return saveRepair(run, page, recipe, local.def, local.result, "local_repair", `${kind}: ${failure.detail}`);
        emit(run, "repair.local_failed", `${host}: no local selector fix passed acceptance; asking the LLM`, {});
        return rediscover(run, page, recipe, input.fields, `${kind}: ${failure.detail}`);
      }

      case "ESCALATE":
        return rediscover(run, page, recipe, input.fields, `${kind}: ${failure.detail}`);
    }
  }
  return null;
}

function localRepair(run: RunContext, page: FetchedPage, recipe: Recipe, fields: FieldSpec[]) {
  const roles = Object.fromEntries(fields.map((f) => [f.name, f.catalogKey]));
  return relaxRecipe({ html: page.html, url: page.url, state: toPageState(page.html, page.url), def: recipe.def, acceptance: recipe.acceptance, roles });
}

async function rediscover(run: RunContext, page: FetchedPage, parent: Recipe, fields: FieldSpec[], failureReport: string) {
  const found = await discoverRecipe(run, { html: page.html, url: page.url, state: toPageState(page.html, page.url) }, fields, {
    origin: "llm_repair",
    parent,
    failureReport,
  });
  if (!found) return null;
  noteRepair(run, parent, found.recipe, failureReport, `rediscovered with the LLM in ${found.attempts} attempt${found.attempts > 1 ? "s" : ""}`);
  return { recipe: found.recipe, result: found.result, page };
}

async function saveRepair(run: RunContext, page: FetchedPage, parent: Recipe, def: Recipe["def"], result: ReplayResult, origin: Recipe["origin"], failure: string) {
  const recipe = await saveRecipe({
    host: parent.host,
    urlPattern: parent.urlPattern,
    pageType: parent.pageType,
    parentId: parent.id,
    origin,
    def,
    acceptance: parent.acceptance,
  });
  noteRepair(run, parent, recipe, failure, "fixed selectors locally, no LLM needed");
  return { recipe, result, page };
}

function noteRepair(run: RunContext, parent: Recipe, recipe: Recipe, failure: string, how: string) {
  run.repairs.push({ host: parent.host, fromVersion: parent.version, toVersion: recipe.version, origin: recipe.origin, failure });
  emit(run, "recipe.repaired", `${parent.host}: recipe v${parent.version} → v${recipe.version}, ${how}`, {
    recipeId: recipe.id,
    parentId: parent.id,
    version: recipe.version,
    origin: recipe.origin,
    def: recipe.def,
  });
}

const emit = (run: RunContext, type: string, message: string, data: Record<string, unknown>) =>
  run.emit({ stage: "extracting", type, level: type === "repair.local_failed" ? "warn" : "info", message, data });
