import * as cheerio from "cheerio";
import { z } from "zod";
import { itemKeyFor } from "../execute/contractFields";
import { runLadder } from "../extract/ladder";
import { jsonLdField, jsonLdRung } from "../extract/rungs/jsonLd";
import { llmRung } from "../extract/rungs/llm";
import { readSchemaField, schemaListItems } from "../extract/schemaOrg";
import { LlmError } from "../llm/client";
import { htmlToText } from "../libs/text";
import { canonicalUrl } from "../libs/url";
import { extractJsonLd } from "../page/structured";
import type { RunContext } from "../runs/runContext";
import { derived } from "./fields";
import { everyField, type FieldValue, type Item, type SourceAdapter } from "./types";

const HtmlRecordParams = z.object({ url: z.string().url() });
type HtmlRecordParams = z.infer<typeof HtmlRecordParams>;

/** Page chrome that never holds the record's own facts. */
const CHROME = "script, style, noscript, svg, nav, header, footer, aside, form";

/**
 * A page about one record (a creator's own site, a company's about page). Its fields come from
 * the page's JSON-LD, then from the LLM, whose values are kept only when their verbatim quote is
 * found in the page text. A page whose JSON-LD is an ItemList yields each listed record instead.
 */
export const htmlRecord: SourceAdapter<HtmlRecordParams> = {
  id: "html_record",
  kind: "html",
  params: HtmlRecordParams,
  provides: everyField("LLM"),

  async collect({ fetcher, scope, run }, { url }) {
    if (!run) throw new Error("html_record needs the run context for extraction");
    const page = await fetcher.fetch(scope, { url, expect: "html", purpose: "record page", mode: "auto" });
    const source = { sourceUrl: page.finalUrl, pageId: page.pageId };
    const fields = run.contract.fields.filter((f) => f.catalogKey !== "match_reason");
    const $ = cheerio.load(page.body);

    const listed = schemaListItems(extractJsonLd($));
    if (listed.length > 1) {
      return listed.map((record, i) => {
        const values = fields.flatMap((f) => {
          const read = readSchemaField(record, f);
          return read ? [[f.name, jsonLdField(read.value, `ItemList.itemListElement[${i}].${read.path}`, source)] as const] : [];
        });
        return toItem(run, `${page.finalUrl}#${i}`, Object.fromEntries(values), null);
      });
    }

    $(CHROME).remove();
    const text = htmlToText($.html());
    const input = { text, html: page.body, ...source };
    const filled = await runLadder(run, input, fields, [jsonLdRung]);
    const urlField = fields.find((f) => f.catalogKey === "url");
    if (urlField && !filled[urlField.name]) filled[urlField.name] = derived(page.finalUrl, page.finalUrl, "the record's own page", page.finalUrl, page.pageId)!;
    try {
      Object.assign(filled, await runLadder(run, input, fields.filter((f) => !filled[f.name]), [llmRung]));
    } catch (err) {
      if (!(err instanceof LlmError)) throw err;
    }
    return [toItem(run, canonicalUrl(page.finalUrl) ?? page.finalUrl, filled, { plain: text, ...source })];
  },
};

/** An item keyed by catalog key, from values keyed by contract field name. */
function toItem(run: RunContext, externalId: string, byName: Record<string, FieldValue>, text: Item["text"]): Item {
  const fields = Object.fromEntries(Object.entries(byName).map(([name, value]) => [itemKeyFor(run.contract, name), value]));
  return { externalId, fields, text, meta: {} };
}
