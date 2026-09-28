import type { Recipe, RecipeDef, RecipeField } from "@repo/contracts";
import { isGeneratedClass } from "../page/selectors";
import type { PageState } from "../page/pageState";
import { acceptanceFailure, replayRecipe, type ReplayResult } from "../recipes/replay";

/**
 * Local selector repair: cheap, deterministic fixes tried before asking the LLM to
 * rediscover a recipe. It handles the common small drifts:
 *   - a rebuilt site whose generated class hashes changed ("title--x1Y2z" → "title--q9R8s")
 *   - a renamed item wrapper whose inner markup survived (found via the page's repeated groups)
 *   - identifying fields that moved inside the item (title → a heading, url → a link)
 * A candidate is only returned if it passes the recipe's acceptance thresholds.
 */

/** Generic places a field's value tends to live inside an item, by catalog key. */
const ROLE_FALLBACKS: Record<string, Array<Pick<RecipeField, "selector" | "attr" | "transform">>> = {
  title: ["h1", "h2", "h3", "h4", "a", '[class*="title"]'].map((selector) => ({ selector, attr: "text", transform: "trim" })),
  url: [
    { selector: "a[href]", attr: "href", transform: "absolute_url" },
    { selector: "", attr: "href", transform: "absolute_url" },
  ],
  location: [{ selector: '[class*="location"]', attr: "text", transform: "trim" }],
  department: ['[class*="department"]', '[class*="team"]'].map((selector) => ({ selector, attr: "text", transform: "trim" })),
};

/** How many of the page's repeated groups are tried as replacement item selectors. */
const MAX_GROUPS = 5;

export interface RelaxInput {
  html: string;
  url: string;
  state: PageState;
  def: RecipeDef;
  acceptance: Recipe["acceptance"];
  /** Catalog key per recipe field name, used to pick role fallbacks. */
  roles: Record<string, string>;
}

export function relaxRecipe(input: RelaxInput): { def: RecipeDef; result: ReplayResult } | null {
  const { html, url, state, def, acceptance } = input;
  const itemCandidates = unique([
    def.itemSelector,
    stripGeneratedHashes(def.itemSelector),
    ...state.groups.slice(0, MAX_GROUPS).map((g) => g.selector),
  ]);

  let best: { def: RecipeDef; result: ReplayResult; score: number } | null = null;
  for (const itemSelector of itemCandidates) {
    const fields = def.fields.map((field) => bestFieldVariant(html, url, itemSelector, field, input.roles[field.name]));
    const candidate: RecipeDef = { itemSelector, fields };
    const result = replayRecipe(html, url, candidate);
    if (acceptanceFailure(result, acceptance)) continue;
    const score = average(Object.values(result.fill));
    if (!best || score > best.score) best = { def: candidate, result, score };
  }
  return best && { def: best.def, result: best.result };
}

/** The variant of one field's selector that fills the most items under `itemSelector`. */
function bestFieldVariant(html: string, url: string, itemSelector: string, field: RecipeField, role: string | undefined): RecipeField {
  const variants: RecipeField[] = uniqueBy(
    [
      field,
      { ...field, selector: stripGeneratedHashes(field.selector) },
      ...(ROLE_FALLBACKS[role ?? ""] ?? []).map((v) => ({ ...field, ...v })),
    ],
    (v) => `${v.selector}@${v.attr}`,
  );
  let best = field;
  let bestFill = -1;
  for (const variant of variants) {
    const fill = replayRecipe(html, url, { itemSelector, fields: [variant] }).fill[field.name] ?? 0;
    if (fill > bestFill) {
      best = variant;
      bestFill = fill;
    }
  }
  return best;
}

/**
 * Replaces generated class names that keep a readable prefix with a prefix match:
 * ".title--x1Y2z" → '[class*="title--"]'. Hashes with no readable prefix are left alone.
 */
export function stripGeneratedHashes(selector: string): string {
  return selector.replace(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g, (whole, name: string) => {
    if (!isGeneratedClass(name)) return whole;
    const prefix = /^(.{3,}?(?:--|__))[A-Za-z0-9_-]+$/.exec(name)?.[1];
    return prefix ? `[class*="${prefix}"]` : whole;
  });
}

const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
const uniqueBy = <T>(values: T[], key: (v: T) => string) => [...new Map(values.map((v) => [key(v), v])).values()];
const average = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
