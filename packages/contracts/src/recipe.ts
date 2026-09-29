import { z } from "zod";

/**
 * A recorded extraction procedure for a list page (record/replay).
 * Discovered once with AI, then replayed deterministically with CSS selectors.
 */
export const RecipeField = z.object({
  name: z.string(),
  selector: z.string().describe("CSS selector relative to the item element; empty = the item itself"),
  attr: z.string().describe('"text", "href", "content", or any attribute name'),
  transform: z.enum(["trim", "absolute_url"]).nullable(),
});
export type RecipeField = z.infer<typeof RecipeField>;

export const RecipeDef = z.object({
  itemSelector: z.string(),
  fields: z.array(RecipeField),
});
export type RecipeDef = z.infer<typeof RecipeDef>;

export const RecipeOrigin = z.enum(["llm_discovery", "local_repair", "llm_repair", "simulated_drift"]);

export const Recipe = z.object({
  id: z.string(),
  host: z.string(),
  pageType: z.enum(["job_list", "list"]),
  urlPattern: z.string(),
  version: z.number().int(),
  parentId: z.string().nullable(),
  status: z.enum(["active", "degraded", "retired"]),
  origin: RecipeOrigin,
  def: RecipeDef,
  acceptance: z.object({ minItems: z.number(), minFill: z.record(z.string(), z.number()) }),
  stats: z.object({ uses: z.number(), failures: z.number(), lastFill: z.number().nullable() }),
  createdAt: z.string(),
});
export type Recipe = z.infer<typeof Recipe>;

export const ListRecipesQuery = z.object({ host: z.string().optional() });

/** Records a deliberately broken recipe version to demonstrate self-repair. */
export const SimulateDriftRequest = z.object({ mode: z.enum(["minor", "major"]).default("major") });
export type SimulateDriftRequest = z.infer<typeof SimulateDriftRequest>;
