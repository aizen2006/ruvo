import { RecipeDef, type FieldSpec, type Recipe } from "@repo/contracts";
import type { PageState } from "../page/pageState";
import { pageSkeleton } from "../page/skeleton";
import type { RunContext } from "../runs/runContext";
import { acceptanceFailure, replayRecipe, type ReplayResult } from "./replay";
import { saveRecipe, urlPatternOf } from "./store";

const MAX_ATTEMPTS = 2;

const SYSTEM_PROMPT = `You write extraction recipes for list pages. A recipe has:
- itemSelector: a CSS selector matching every record on the page (e.g. each job listing) and nothing else
- fields: for each requested field, a CSS selector RELATIVE to the item ("" means the item itself), the attribute to read ("text" for visible text, "href" for links, or another attribute name), and an optional transform ("absolute_url" for links, "trim", or null)
Prefer stable hooks: data-ui / data-testid / data-qa attributes, itemprop, ids, and meaningful class names.
Avoid generated class names such as "styles--1vo9F", "css-1x2y3z" or "sc-bdVaJa"; they change whenever the site is rebuilt.
Only include fields the page actually shows for each item.`;

export interface Discovered {
  recipe: Recipe;
  result: ReplayResult;
  attempts: number;
}

/**
 * Discovers a recipe for a list page with the planner model. Each proposal is executed
 * against the page and must pass acceptance before it is saved; a failed attempt is
 * retried once with the failure report. Returns null if no proposal passes.
 */
export async function discoverRecipe(
  ctx: Pick<RunContext, "runId" | "llm" | "signal" | "budget" | "metrics">,
  page: { html: string; url: string; state: PageState },
  fields: FieldSpec[],
  opts: { origin: Recipe["origin"]; parent?: Recipe | null; failureReport?: string } = { origin: "llm_discovery" },
): Promise<Discovered | null> {
  const acceptance = acceptanceFor(fields);
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
        pageOutline: pageSkeleton(page.html),
      }),
      signal: ctx.signal,
      run: ctx,
    });

    const result = replayRecipe(page.html, page.url, def);
    const failure = acceptanceFailure(result, acceptance);
    if (!failure) {
      const recipe = await saveRecipe({
        ...urlPatternOf(page.url),
        pageType: "job_list",
        parentId: opts.parent?.id ?? null,
        origin: opts.origin,
        def,
        acceptance,
      });
      return { recipe, result, attempts: attempt };
    }
    feedback = `${failure.kind}: ${failure.detail}. Selectors used: ${JSON.stringify(def)}`;
  }
  return null;
}

/** A list page must yield several items, and every required field for nearly all of them. */
export function acceptanceFor(fields: FieldSpec[]): Recipe["acceptance"] {
  return {
    minItems: 3,
    minFill: Object.fromEntries(fields.filter((f) => f.required).map((f) => [f.name, 0.8])),
  };
}
