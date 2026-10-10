import * as cheerio from "cheerio";
import type { FieldValue } from "../../core/items";
import { packOf } from "../../domains";
import { truncate } from "../../libs/text";
import { extractJsonLd } from "../../page/structured";
import type { ExtractorRung } from "../ladder";

/**
 * Reads the schema.org JSON-LD pages publish for search engines, with the contract's domain's
 * readers: a JobPosting for a job request, otherwise the record the page describes (a person,
 * organization, product, event…). Structured and exact, so it outranks DOM, regex and LLM extraction.
 */
export const jsonLdRung: ExtractorRung = {
  rung: "json_ld",
  async fill(ctx, fields, input) {
    if (!input.html) return {};
    const items = extractJsonLd(cheerio.load(input.html));
    for (const reader of packOf(ctx.contract).jsonLd ?? []) {
      const record = items.find((node) => reader.matches(node));
      if (!record) continue;
      const type = String(([] as unknown[]).concat(record["@type"])[0]);
      const out: Record<string, FieldValue> = {};
      for (const field of fields) {
        const read = reader.read(record, field);
        if (read) out[field.name] = jsonLdField(read.value, `${type}.${read.path}`, input);
      }
      return out;
    }
    return {};
  },
};

/** A value read from JSON-LD, with `path` naming the property it came from. */
export function jsonLdField(value: string, path: string, source: { sourceUrl: string; pageId: string | null }): FieldValue {
  return {
    value,
    evidence: {
      method: "JSON_LD",
      sourceUrl: source.sourceUrl,
      pageId: source.pageId,
      snippet: truncate(value, 300),
      locator: { kind: "jsonLd", value: path },
      verified: true,
    },
  };
}
