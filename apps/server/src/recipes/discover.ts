import { RecipeDef, type FieldSpec, type Recipe } from "@repo/contracts";
import { fitText } from "../page/fitText";
import type { PageState } from "../page/pageState";
import type { RunContext } from "../runs/runContext";
import { acceptanceFailure, replayRecipe, type ReplayResult } from "./replay";
import { seedRecipe } from "./seed";
import { saveRecipe, urlPatternOf } from "./store";

/** Whole-recipe proposals after the example record: one, plus one retry with the failure report. */
const MAX_ATTEMPTS = 2;
/** Size of the pruned page view the LLM reads. */
const VIEW_CHARS = 12_000;

const SYSTEM_PROMPT = `You write extraction recipes for list pages. A recipe has:
- itemSelector: a CSS selector matching every record on the page (e.g. each job listing) and nothing else
- fields: for each requested field, a CSS selector RELATIVE to the item ("" means the item itself), the attribute to read ("text" for visible text, "href" for links, or another attribute name), and an optional transform ("absolute_url" for links, "trim", or null)
Prefer stable hooks: data-ui / data-testid / data-qa attributes, itemprop, ids, and meaningful class names.
Avoid generated class names such as "styles--1vo9F", "css-1x2y3z" or "sc-bdVaJa"; they change whenever the site is rebuilt.
Only include fields the page actually shows for each item.`;

export interface Discovered {
  recipe: Recipe;
  result: ReplayResult;
  /** LLM calls made, the example record included. */
  attempts: number;
  /** "seed": expanded from one example record; "prompt": proposed whole by the LLM. */
  method: "seed" | "prompt";
}

/**
 * Discovers a recipe for a list page with the planner model. First the LLM copies one
 * example record, which code expands into a recipe (seed.ts); if that fails, the LLM proposes
 * a whole recipe, retried once with the failure report. Every candidate is executed against
 * the page and must pass acceptance before it is saved. Returns null if none passes.
 */
export async function discoverRecipe(
  ctx: Pick<RunContext, "runId" | "llm" | "signal" | "budget" | "metrics">,
  page: { html: string; url: string; state: PageState },
  fields: FieldSpec[],
  opts: { origin: Recipe["origin"]; parent?: Recipe | null; failureReport?: string } = { origin: "llm_discovery" },
): Promise<Discovered | null> {
  const acceptance = acceptanceFor(fields);
  const view = fitText(page.html, fields.map((f) => `${f.name} ${f.description}`).join(" "), VIEW_CHARS);
  const accept = async (def: RecipeDef, result: ReplayResult, attempts: number, method: Discovered["method"]): Promise<Discovered> => {
    const recipe = await saveRecipe({
      ...urlPatternOf(page.url),
      pageType: "job_list",
      parentId: opts.parent?.id ?? null,
      origin: opts.origin,
      def,
      acceptance,
    });
    return { recipe, result, attempts, method };
  };

  const seeded = await seedRecipe(ctx, { url: page.url, html: page.html, view }, fields);
  if (seeded) {
    const result = replayRecipe(page.html, page.url, seeded);
    if (!acceptanceFailure(result, acceptance)) return accept(seeded, result, 1, "seed");
  }

  let feedback = opts.failureReport ?? null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { data: def } = await ctx.llm.parse({
      stage: "discover_recipe",
      role: "planner",
      schema: RecipeDef,
      name: "recipe",
      system: SYSTEM_PROMPT,
      user: JSON.stringify({
        url: page.url,
        fields: fields.map((f) => ({ name: f.name, description: f.description })),
        likelyItemGroups: page.state.groups.map((g) => ({ selector: g.selector, count: g.count, samples: g.samples })),
        previousRecipe: opts.parent?.def ?? null,
        problemWithPreviousAttempt: feedback,
        pageView: view,
      }),
      signal: ctx.signal,
      run: ctx,
    });

    const result = replayRecipe(page.html, page.url, def);
    const failure = acceptanceFailure(result, acceptance);
    if (!failure) return accept(def, result, attempt + 1, "prompt");
    feedback = `${failure.kind}: ${failure.detail}. Selectors used: ${JSON.stringify(def)}`;
  }
  return null;
}

/** Fields that identify a record; a recipe that cannot read them reliably is broken. */
const IDENTIFYING = new Set(["title", "url"]);

/**
 * A recipe must read the page correctly, not prove the page has every value: identifying
 * fields must be found for nearly all items, other required fields for at least some.
 * (Pages legitimately omit values, e.g. no location on remote roles; those records are
 * reported as incomplete downstream rather than failing the recipe.)
 */
export function acceptanceFor(fields: FieldSpec[]): Recipe["acceptance"] {
  return {
    minItems: 3,
    minFill: Object.fromEntries(
      fields.filter((f) => f.required || IDENTIFYING.has(f.catalogKey)).map((f) => [f.name, IDENTIFYING.has(f.catalogKey) ? 0.8 : 0.25]),
    ),
  };
}
