import { ListRecipesQuery, SimulateDriftRequest } from "@repo/contracts";
import { Router } from "express";
import { env } from "../config/env";
import { getRecipe, listRecipes, saveRecipe } from "../recipes/store";
import { driftRecipe } from "../repair/drift";
import { parseId } from "./params";

/** Recorded extraction recipes and their version lineage. */
export const recipesRouter = Router();

recipesRouter.get("/", async (req, res) => {
  const { host } = ListRecipesQuery.parse(req.query);
  res.json(await listRecipes(host));
});

/**
 * Records a broken copy of a recipe as its newest version, so the next run that reads the
 * page has to repair it. The simulated version stays in the lineage. Demo-only: not served in production.
 */
if (env.NODE_ENV !== "production") recipesRouter.post("/:id/simulate-drift", async (req, res) => {
  const { mode } = SimulateDriftRequest.parse(req.body ?? {});
  const source = await getRecipe(parseId(req.params.id, "Recipe"));
  const drifted = await saveRecipe({
    host: source.host,
    urlPattern: source.urlPattern,
    pageType: source.pageType,
    parentId: source.id,
    origin: "simulated_drift",
    def: driftRecipe(source.def, mode),
    acceptance: source.acceptance,
  });
  res.status(201).json(drifted);
});
