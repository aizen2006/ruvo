import type { DatasetContract, FieldSpec } from "@repo/contracts";
import { z } from "zod";
import { itemKeyFor, type FieldValue, type Item } from "../core/items";
import type { RunContext } from "../core/run";
import { packOf, parserOf } from "../domains";
import { FetchError } from "../fetch/errors";
import type { FetchResult } from "../fetch/fetcher";
import { canonicalUrl } from "../libs/url";
import { nextPageUrl } from "../page/pagination";
import { siteOwner } from "../page/siteOwner";
import { readWithRecipe } from "../recipes/lifecycle";
import { replayRecipe, type RecipeRow } from "../recipes/replay";
import { explainFailure } from "../repair/classify";
import type { FetchedPage, RepairInput } from "../repair/repairRecipe";
import { truncate } from "../libs/text";
import { compactFields, derived } from "./fields";
import type { SourceAdapter } from "./types";

const HtmlListParams = z.object({
  url: z.string().url(),
  company: z.string().optional(),
  tags: z.array(z.string()).default([]),
});
type HtmlListParams = z.infer<typeof HtmlListParams>;

/** Fields a list page can show; long text and generated fields are read elsewhere. */
const LIST_FIELDS = new Set(["company", "title", "location", "remote", "salary", "url", "department", "employment_type", "posted_at", "custom"]);
/** How an escalated list page was finally read, for the activity log. */
const ESCALATED_BY: Partial<Record<FetchResult["via"], string>> = {
  browser: " over HTTP, rendered in the browser",
  stealth: ", opened in the stealth browser",
  firecrawl: ", read through Firecrawl",
};

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
  provides: { company: "DOM", title: "DOM", location: "DOM", remote: "DOM", salary: "DOM", url: "DOM", department: "DOM", employment_type: "DOM", custom: "DOM" },

  async collect({ fetcher, scope, run }, { url, company, tags }) {
    if (!run) throw new Error("html_list needs the run context for recipe discovery");
    const page = await fetcher.fetch(scope, { url, expect: "html", purpose: "list page", mode: "auto" });
    if (page.escalation) {
      run.emit({
        stage: "collecting",
        type: "fetch.escalated",
        message: `${new URL(url).host}: ${page.escalation.reason}${ESCALATED_BY[page.via] ?? ""}`,
        data: { ...page.escalation, via: page.via },
      });
    }

    // A company's own board doesn't repeat the company name per item, so in a domain whose records
    // name their page's owner (a job's company), the registry supplies it; for a linked page it is
    // read from the page itself, and a recipe need not find it per item.
    const { ownerField } = packOf(run.contract);
    const owner = !ownerField ? null : company ? { name: company, basis: new URL(url).host, rule: "registry board owner" } : pageOwner(page.body);
    const fields = run.contract.fields
      .filter((f) => LIST_FIELDS.has(f.catalogKey) && !(company && f.catalogKey === ownerField))
      .map((f) => (owner && f.catalogKey === ownerField ? { ...f, required: false } : f));
    const ownerKey = run.contract.fields.find((f) => f.catalogKey === ownerField)?.name;
    const refetch: RepairInput["refetch"] = async (mode) => {
      const again = await fetcher.fetch(scope, { url, expect: "html", purpose: "list page (retry)", mode, fresh: true });
      return toFetched(again);
    };
    const read = await readWithRecipe(run, toFetched(page), fields, refetch);
    const { recipe } = read;

    const toItems = (listPage: FetchedPage, rows: RecipeRow[]) => rows.map((row, i): Item => {
      const sourceUrl = listPage.finalUrl;
      const values = compactFields(
        Object.fromEntries(
          recipe.def.fields.map((f) => [
            itemKeyFor(run.contract, f.name),
            domField(
              row[f.name] ?? null,
              fieldOf(run, f.name),
              run.contract,
              `${recipe.def.itemSelector} ${f.selector || ":scope"} @${f.attr}`,
              sourceUrl,
              listPage.pageId,
            ),
          ]),
        ),
      );
      if (ownerKey && !values[ownerKey] && owner) {
        values[ownerKey] = derived(owner.name, owner.basis, owner.rule, sourceUrl, listPage.pageId)!;
      }
      return {
        externalId: row[fields.find((f) => f.catalogKey === "url")?.name ?? "url"] ?? `${sourceUrl}#${i}`,
        fields: values,
        text: null,
        meta: { companyTags: tags, recipe: { id: recipe.id, version: recipe.version } },
      };
    });

    const items = toItems(read.page, read.result.rows);
    const seen = new Set([url, read.page.finalUrl].map(canonical));
    let current = read.page;
    let pagesRead = 1;
    // Follow "next" links with the same recipe until a page adds nothing new or the mode's cap is reached.
    while (pagesRead < (run.maxListPages ?? 1)) {
      const next = nextPageUrl(current.html, current.finalUrl);
      if (!next || seen.has(canonical(next))) break;
      seen.add(canonical(next));
      try {
        current = toFetched(await fetcher.fetch(scope, { url: next, expect: "html", purpose: "list page", mode: "auto" }));
      } catch (err) {
        if (!(err instanceof FetchError)) throw err;
        run.emit({ stage: "collecting", type: "pagination.stopped", level: "warn", message: `${new URL(next).host}: stopped paging, ${explainFailure(err)}` });
        break;
      }
      if (canonical(current.finalUrl) !== canonical(next) && seen.has(canonical(current.finalUrl))) break;
      const known = new Set(items.map((item) => item.externalId));
      const fresh = toItems(current, replayRecipe(current.html, current.finalUrl, recipe.def).rows).filter((item) => !known.has(item.externalId));
      if (fresh.length === 0) break;
      items.push(...fresh);
      pagesRead++;
    }
    if (pagesRead > 1) {
      run.emit({ stage: "collecting", type: "pagination.followed", message: `${new URL(url).host}: read ${pagesRead} list pages, ${items.length} items` });
    }
    return items;
  },
};

const canonical = (url: string) => canonicalUrl(url) ?? url;

/**
 * A value read from the page. Values the domain parses (a job's arrangement or pay) and numbers are
 * normalized like every other source ("Remote" → "remote", "1,204 points" → "1204"); the snippet
 * keeps the page's original text.
 */
function domField(
  raw: string | null,
  field: FieldSpec | undefined,
  contract: DatasetContract,
  locator: string,
  sourceUrl: string,
  pageId: string | null,
): FieldValue | undefined {
  if (!raw) return undefined;
  const normalize = parserOf(contract, field?.catalogKey ?? "custom")?.normalize;
  const value = normalize ? normalize(raw) : field?.type === "number" ? (firstNumber(raw) ?? raw) : raw;
  return {
    value,
    evidence: { method: "DOM", sourceUrl, pageId, snippet: truncate(raw, 300), locator: { kind: "css", value: locator }, verified: true },
  };
}

const fieldOf = (run: RunContext, name: string) => run.contract.fields.find((f) => f.name === name);

/** The first number in a text, as a plain numeric string ("1,204 points" → "1204"). */
const firstNumber = (text: string) => /-?\d[\d,]*(?:\.\d+)?/.exec(text)?.[0].replace(/,/g, "") ?? null;

const toFetched = (r: FetchResult): FetchedPage => ({ html: r.body, url: r.url, finalUrl: r.finalUrl, pageId: r.pageId, via: r.via });

/** The organization a linked page belongs to, as a derived company value. */
function pageOwner(html: string) {
  const found = siteOwner(html);
  return found && { name: found.name, basis: found.basis, rule: "organization named by the page" };
}
