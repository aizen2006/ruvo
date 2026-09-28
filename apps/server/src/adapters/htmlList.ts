import type { FieldSpec, Recipe } from "@repo/contracts";
import { z } from "zod";
import type { FetchResult } from "../fetch/fetcher";
import { toPageState } from "../page/pageState";
import { discoverRecipe } from "../recipes/discover";
import { acceptanceFailure, replayRecipe, type ReplayResult } from "../recipes/replay";
import { findActiveRecipe, recordRecipeUse } from "../recipes/store";
import { repairRecipe, type FetchedPage, type RepairInput } from "../repair/repairRecipe";
import { itemKeyFor } from "../execute/contractFields";
import { detectArrangement } from "../extract/parsers/remote";
import { formatSalary, parseSalary } from "../extract/parsers/salary";
import { truncate } from "../libs/text";
import type { RunContext } from "../runs/runContext";
import { compactFields, derived } from "./fields";
import type { FieldValue, Item, SourceAdapter } from "./types";

const HtmlListParams = z.object({
  url: z.string().url(),
  company: z.string().optional(),
  tags: z.array(z.string()).default([]),
});
type HtmlListParams = z.infer<typeof HtmlListParams>;

/** Fields a list page can show; long text and generated fields are read elsewhere. */
const LIST_FIELDS = new Set(["company", "title", "location", "remote", "salary", "url", "department", "employment_type", "posted_at", "custom"]);

/**
 * Any public list page (a careers board, or a URL the user pasted). The page is fetched in
 * auto mode (browser only when needed), then read with the recorded recipe for its URL
 * pattern. Without a working recipe, one is discovered with the LLM and recorded, so later
 * runs replay it with no LLM calls.
 */
export const htmlList: SourceAdapter<HtmlListParams> = {
  id: "html_list",
  kind: "html",
  params: HtmlListParams,
  provides: { company: "DOM", title: "DOM", location: "DOM", remote: "DOM", salary: "DOM", url: "DOM", department: "DOM", employment_type: "DOM" },

  async collect({ fetcher, scope, run }, { url, company, tags }) {
    if (!run) throw new Error("html_list needs the run context for recipe discovery");
    const page = await fetcher.fetch(scope, { url, expect: "html", purpose: "list page", mode: "auto" });
    if (page.escalation) {
      run.emit({
        stage: "collecting",
        type: "fetch.escalated",
        message: `${new URL(url).host}: ${page.escalation.reason} over HTTP, rendered in the browser`,
        data: page.escalation,
      });
    }

    // A company's own board doesn't repeat the company name per item; the registry supplies it.
    const fields = run.contract.fields.filter((f) => LIST_FIELDS.has(f.catalogKey) && !(company && f.catalogKey === "company"));
    const refetch = async (mode: "http" | "browser"): Promise<FetchedPage> => {
      const again = await fetcher.fetch(scope, { url, expect: "html", purpose: "list page (retry)", mode, fresh: true });
      return toFetched(again);
    };
    const read = await readWithRecipe(run, toFetched(page), fields, refetch);
    const { recipe, result } = read;

    return result.rows.map((row, i): Item => {
      const sourceUrl = read.page.finalUrl;
      const values = compactFields(
        Object.fromEntries(
          recipe.def.fields.map((f) => [
            itemKeyFor(run.contract, f.name),
            domField(
              row[f.name] ?? null,
              catalogKeyOf(run, f.name),
              `${recipe.def.itemSelector} ${f.selector || ":scope"} @${f.attr}`,
              sourceUrl,
              read.page.pageId,
            ),
          ]),
        ),
      );
      if (!values.company && company) values.company = derived(company, new URL(url).host, "registry board owner", sourceUrl, read.page.pageId)!;
      return {
        externalId: row[fields.find((f) => f.catalogKey === "url")?.name ?? "url"] ?? `${url}#${i}`,
        fields: values,
        text: null,
        meta: { companyTags: tags, recipe: { id: recipe.id, version: recipe.version } },
      };
    });
  },
};

/**
 * Replays the active recipe. When it no longer fits the page, the repair policy fixes it
 * (refetch, local selector repair or LLM rediscovery); with no recipe yet, one is discovered.
 */
/** The recipe that read the page, its rows, and the page it read (a repair may have refetched it). */
interface RecipeRead {
  recipe: Recipe;
  result: ReplayResult;
  page: FetchedPage;
}

async function readWithRecipe(run: RunContext, page: FetchedPage, fields: FieldSpec[], refetch: RepairInput["refetch"]): Promise<RecipeRead> {
  const { html, url } = page;
  const host = new URL(url).host;
  const existing = await findActiveRecipe(url);
  if (!existing) return discoverOrThrow(run, page, fields);

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

async function discoverOrThrow(run: RunContext, page: FetchedPage, fields: FieldSpec[]): Promise<RecipeRead> {
  const { html, url } = page;
  const host = new URL(url).host;
  const discovered = await discoverRecipe(run, { html, url, state: toPageState(html, url) }, fields, { origin: "llm_discovery" });
  if (!discovered) throw new Error(`Could not find a reliable way to read ${host}`);
  run.emit({
    stage: "extracting",
    type: "recipe.discovered",
    message: `${host}: recorded recipe v${discovered.recipe.version} (${discovered.result.itemCount} items, ${discovered.attempts} LLM attempt${discovered.attempts > 1 ? "s" : ""}); later runs replay it`,
    data: { recipeId: discovered.recipe.id, version: discovered.recipe.version, def: discovered.recipe.def },
  });
  return { recipe: discovered.recipe, result: discovered.result, page };
}

/**
 * A value read from the page. Arrangement and salary are normalized like every other source
 * ("Remote" → "remote"); the snippet keeps the page's original text.
 */
function domField(raw: string | null, catalogKey: string, locator: string, sourceUrl: string, pageId: string | null): FieldValue | undefined {
  if (!raw) return undefined;
  const salary = catalogKey === "salary" ? parseSalary(raw) : null;
  const value = catalogKey === "remote" ? (detectArrangement(raw) ?? raw.toLowerCase()) : salary ? formatSalary(salary) : raw;
  return {
    value,
    evidence: { method: "DOM", sourceUrl, pageId, snippet: truncate(raw, 300), locator: { kind: "css", value: locator }, verified: true },
  };
}

const catalogKeyOf = (run: RunContext, name: string) => run.contract.fields.find((f) => f.name === name)?.catalogKey ?? "custom";

const averageFill = (r: ReplayResult) => {
  const values = Object.values(r.fill);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
};

const toFetched = (r: FetchResult): FetchedPage => ({ html: r.body, url: r.url, finalUrl: r.finalUrl, pageId: r.pageId, via: r.via });
