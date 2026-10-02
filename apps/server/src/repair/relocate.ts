import type { Recipe, RecipeDef } from "@repo/contracts";
import * as cheerio from "cheerio";
import { and, desc, eq, exists } from "drizzle-orm";
import { env } from "../config/env";
import { db } from "../db/client";
import { evidence, pages } from "../db/schema";
import { createScraplingClient } from "../fetch/scrapling";
import { logger } from "../libs/logger";
import { selectAll } from "../page/selectors";
import { findSimilar } from "../page/similar";
import { acceptanceFailure, replayRecipe, type ReplayResult } from "../recipes/replay";
import { groupSelector, relativeSelector } from "../recipes/seed";

/** RUVO's Scrapling service does the relocating; without it this repair is skipped. */
const scrapling = env.SCRAPLING_URL ? createScraplingClient(env.SCRAPLING_URL) : null;

/**
 * AI-free repair for a changed page, tried after the local fix: Scrapling's adaptive parser finds the recipe's item
 * and fields, as they were on the last page the recipe read, on the new page, and their selectors are written the
 * way discovery writes them. Like any repair, the result must pass the recipe's acceptance checks.
 */
export async function relocateRecipe(page: { html: string; url: string }, recipe: Recipe, signal: AbortSignal): Promise<{ def: RecipeDef; result: ReplayResult } | null> {
  if (!scrapling) return null;
  const before = await lastPageRead(page.url, recipe);
  if (!before) return null;
  // lxml (Scrapling's parser) and cheerio build different trees from malformed markup, such as a table without
  // tbody; given cheerio's own serialization they see the same elements, so the paths that come back resolve here.
  const $ = cheerio.load(page.html);
  const found = await scrapling.relocate({ ...recipe.def, oldHtml: cheerio.load(before).html(), newHtml: $.html() }, signal).catch((err: Error) => {
    if (signal.aborted) throw err;
    logger.warn("Scrapling could not relocate a recipe", { url: page.url, error: err.message });
    return null;
  });
  const item = found?.item ? selectAll($, found.item)[0] : undefined;
  if (!found || !item) return null;

  const fields = recipe.def.fields.map((field) => {
    const path = found.fields[field.name];
    const el = path ? selectAll($, path)[0] : undefined;
    return el && $.contains(item, el) ? { ...field, selector: relativeSelector($, item, el) } : field;
  });
  const def = { itemSelector: groupSelector($, item, findSimilar($, item)), fields };
  const result = replayRecipe(page.html, page.url, def);
  return acceptanceFailure(result, recipe.acceptance) ? null : { def, result };
}

/**
 * The page as the recipe last read it: the newest stored copy that records cite as DOM evidence (such pages are
 * never pruned), if the recipe still reads it. A recipe that never worked, such as a simulated drift, has none.
 */
async function lastPageRead(url: string, recipe: Recipe): Promise<string | null> {
  const [copy] = await db
    .select({ body: pages.body })
    .from(pages)
    .where(and(eq(pages.url, url), exists(db.select().from(evidence).where(and(eq(evidence.pageId, pages.id), eq(evidence.method, "DOM"))))))
    .orderBy(desc(pages.fetchedAt))
    .limit(1);
  return copy && !acceptanceFailure(replayRecipe(copy.body, url, recipe.def), recipe.acceptance) ? copy.body : null;
}
