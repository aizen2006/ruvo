import type { Recipe, RecipeDef } from "@repo/contracts";
import * as cheerio from "cheerio";
import { normalizeWhitespace } from "../libs/text";
import { absoluteUrl } from "../libs/url";

export type RecipeRow = Record<string, string | null>;

export interface ReplayResult {
  rows: RecipeRow[];
  itemCount: number;
  /** Share of items with a value, per field (0..1). */
  fill: Record<string, number>;
}

export type FailureClass = "SELECTOR_MISS" | "PARTIAL_FILL";

/**
 * Applies a recorded recipe to a page: every element matching `itemSelector` is one record,
 * and each field is read from a selector relative to it. Pure and deterministic, so replay
 * needs no LLM and gives the same rows for the same HTML.
 */
export function replayRecipe(html: string, pageUrl: string, def: RecipeDef): ReplayResult {
  const $ = cheerio.load(html);
  let items;
  try {
    items = $(def.itemSelector).toArray();
  } catch {
    // An invalid selector behaves like one that matches nothing.
    return { rows: [], itemCount: 0, fill: Object.fromEntries(def.fields.map((f) => [f.name, 0])) };
  }

  const rows = items.map((item) => {
    const row: RecipeRow = {};
    for (const field of def.fields) {
      let target;
      try {
        target = field.selector ? $(item).find(field.selector).first() : $(item);
      } catch {
        target = $();
      }
      if (target.length === 0) {
        row[field.name] = null;
        continue;
      }
      const raw = field.attr === "text" ? normalizeWhitespace(target.text()) : (target.attr(field.attr) ?? "").trim();
      const value = field.transform === "absolute_url" ? absoluteUrl(raw, pageUrl) : raw;
      row[field.name] = value ? value : null;
    }
    return row;
  });

  const fill = Object.fromEntries(
    def.fields.map((f) => [f.name, rows.length ? rows.filter((r) => r[f.name] !== null).length / rows.length : 0]),
  );
  return { rows, itemCount: rows.length, fill };
}

/** Checks a replay against the recipe's acceptance thresholds; null means it passed. */
export function acceptanceFailure(result: ReplayResult, acceptance: Recipe["acceptance"]): { kind: FailureClass; detail: string } | null {
  if (result.itemCount < acceptance.minItems) {
    return { kind: "SELECTOR_MISS", detail: `item selector matched ${result.itemCount} items, expected at least ${acceptance.minItems}` };
  }
  const weak = Object.entries(acceptance.minFill).filter(([field, min]) => (result.fill[field] ?? 0) < min);
  if (weak.length) {
    return {
      kind: "PARTIAL_FILL",
      detail: weak.map(([field, min]) => `${field} filled for ${Math.round((result.fill[field] ?? 0) * 100)}% of items (need ${Math.round(min * 100)}%)`).join("; "),
    };
  }
  return null;
}
