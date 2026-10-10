import type { FieldSpec, Recipe } from "@repo/contracts";
import type { RunContext } from "../core/run";
import { toPageState } from "../page/pageState";
import { repairRecipe, type FetchedPage, type RepairInput } from "../repair/repairRecipe";
import { acceptanceFor, discoverRecipe } from "./discover";
import { acceptanceFailure, replayRecipe, type ReplayResult } from "./replay";
import { findActiveRecipe, recordRecipeUse } from "./store";

/** The recipe that read the page, its rows, and the page it read (a repair may have refetched it). */
export interface RecipeRead {
  recipe: Recipe;
  result: ReplayResult;
  page: FetchedPage;
}

/**
 * Replays the active recipe. When it no longer fits the page, the repair policy fixes it
 * (refetch, local selector repair or LLM rediscovery); with no recipe yet, or one recorded for
 * other columns, a recipe is discovered for this request's fields.
 */
export async function readWithRecipe(run: RunContext, page: FetchedPage, fields: FieldSpec[], refetch: RepairInput["refetch"]): Promise<RecipeRead> {
  const { html, url } = page;
  const host = new URL(url).host;
  const existing = await findActiveRecipe(url);
  if (!existing) return discoverOrThrow(run, page, fields);

  // Recipes are keyed by page, not by request: one recorded for other columns cannot read the
  // fields this request needs. (Optional fields the page does not show are fine to leave out.)
  const needed = Object.keys(acceptanceFor(fields).minFill);
  const uncovered = fields.filter((f) => needed.includes(f.name) && !existing.def.fields.some((r) => r.name === f.name));
  if (uncovered.length) {
    const names = uncovered.map((f) => f.name).join(", ");
    run.emit({
      stage: "extracting",
      type: "recipe.extended",
      message: `${host}: recipe v${existing.version} does not read ${names}; recording one for this request's columns`,
      data: { recipeId: existing.id, uncovered: uncovered.map((f) => f.name) },
    });
    return discoverOrThrow(run, page, fields, existing, `The previous recipe does not read these fields: ${names}`);
  }

  const result = replayRecipe(html, url, existing.def);
  const failure = acceptanceFailure(result, existing.acceptance);
  await recordRecipeUse(existing.id, { ok: !failure, fill: averageFill(result) });
  if (!failure) {
    run.emit({
      stage: "extracting",
      type: "recipe.replayed",
      message: `${host}: replayed recipe v${existing.version}, ${result.itemCount} items, no LLM needed`,
      data: { recipeId: existing.id, version: existing.version, items: result.itemCount },
    });
    return { recipe: existing, result, page };
  }

  run.emit({
    stage: "extracting",
    type: "recipe.failed",
    level: "warn",
    message: `${host}: recipe v${existing.version} no longer fits the page (${failure.kind}: ${failure.detail})`,
    data: { recipeId: existing.id, failure },
  });
  const repaired = await repairRecipe(run, { page, recipe: existing, result, failure, fields, refetch });
  if (!repaired) throw new Error(`Could not repair the recipe for ${host}`);
  return repaired;
}

async function discoverOrThrow(run: RunContext, page: FetchedPage, fields: FieldSpec[], parent: Recipe | null = null, failureReport?: string): Promise<RecipeRead> {
  const { html, url } = page;
  const host = new URL(url).host;
  const discovered = await discoverRecipe(run, { html, url, state: toPageState(html, url) }, fields, { origin: "llm_discovery", parent, failureReport });
  if (!discovered) throw new Error(`Could not find a reliable way to read ${host}`);
  run.emit({
    stage: "extracting",
    type: "recipe.discovered",
    message: `${host}: recorded recipe v${discovered.recipe.version} (${discovered.result.itemCount} items, ${discovered.method === "seed" ? "from one example record, " : ""}${discovered.attempts} LLM call${discovered.attempts > 1 ? "s" : ""}); later runs replay it`,
    data: { recipeId: discovered.recipe.id, version: discovered.recipe.version, def: discovered.recipe.def },
  });
  return { recipe: discovered.recipe, result: discovered.result, page };
}

const averageFill = (r: ReplayResult) => {
  const values = Object.values(r.fill);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
};
