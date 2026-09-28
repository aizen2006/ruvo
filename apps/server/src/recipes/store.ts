import type { Recipe } from "@repo/contracts";
import { and, desc, eq, max, sql } from "drizzle-orm";
import { db } from "../db/client";
import { recipes } from "../db/schema";
import { notFound } from "../libs/errors";

type RecipeRow = typeof recipes.$inferSelect;

/**
 * Recipes are versioned per host and URL pattern. A pattern generalizes the page's path
 * (apply.workable.com/huggingface/ → apply.workable.com/*) so one recipe serves every
 * board that shares the same markup.
 */
export function urlPatternOf(url: string): { host: string; urlPattern: string } {
  const u = new URL(url);
  const segments = u.pathname.split("/").filter(Boolean);
  return { host: u.host, urlPattern: `${u.host}/${segments.map(() => "*").join("/")}` };
}

export const toRecipe = (row: RecipeRow): Recipe => ({
  id: row.id,
  host: row.host,
  pageType: row.pageType,
  urlPattern: row.urlPattern,
  version: row.version,
  parentId: row.parentId,
  status: row.status,
  origin: row.origin,
  def: row.def,
  acceptance: row.acceptance,
  stats: row.stats,
  createdAt: row.createdAt.toISOString(),
});

/** The newest active recipe for pages like `url`, if one has been recorded. */
export async function findActiveRecipe(url: string, pageType: Recipe["pageType"] = "job_list"): Promise<Recipe | null> {
  const { host, urlPattern } = urlPatternOf(url);
  const [row] = await db
    .select()
    .from(recipes)
    .where(and(eq(recipes.host, host), eq(recipes.urlPattern, urlPattern), eq(recipes.pageType, pageType), eq(recipes.status, "active")))
    .orderBy(desc(recipes.version))
    .limit(1);
  return row ? toRecipe(row) : null;
}

/** Records a new version; earlier active versions of the same pattern are retired. */
export async function saveRecipe(input: Omit<Recipe, "id" | "version" | "status" | "stats" | "createdAt">): Promise<Recipe> {
  return db.transaction(async (tx) => {
    const [latest] = await tx
      .select({ version: max(recipes.version) })
      .from(recipes)
      .where(and(eq(recipes.host, input.host), eq(recipes.urlPattern, input.urlPattern), eq(recipes.pageType, input.pageType)));
    await tx
      .update(recipes)
      .set({ status: "retired" })
      .where(and(eq(recipes.host, input.host), eq(recipes.urlPattern, input.urlPattern), eq(recipes.status, "active")));
    const [row] = await tx
      .insert(recipes)
      .values({ ...input, version: (latest?.version ?? 0) + 1, status: "active", stats: { uses: 0, failures: 0, lastFill: null } })
      .returning();
    return toRecipe(row!);
  });
}

/** Updates usage statistics after a replay. */
export async function recordRecipeUse(id: string, outcome: { ok: boolean; fill: number }) {
  await db
    .update(recipes)
    .set({
      stats: sql`jsonb_build_object(
        'uses', (${recipes.stats}->>'uses')::int + 1,
        'failures', (${recipes.stats}->>'failures')::int + ${outcome.ok ? 0 : 1},
        'lastFill', ${outcome.fill}::float
      )`,
    })
    .where(eq(recipes.id, id));
}

/** Every recipe version, newest first; optionally only those for one host. */
export async function listRecipes(host?: string): Promise<Recipe[]> {
  const rows = await db
    .select()
    .from(recipes)
    .where(host ? eq(recipes.host, host) : undefined)
    .orderBy(recipes.host, recipes.urlPattern, desc(recipes.version));
  return rows.map(toRecipe);
}

export async function getRecipe(id: string): Promise<Recipe> {
  const [row] = await db.select().from(recipes).where(eq(recipes.id, id));
  if (!row) throw notFound("Recipe");
  return toRecipe(row);
}
