import type { FieldSpec } from "@repo/contracts";
import { z } from "zod";
import { itemKeyFor } from "../execute/contractFields";
import { runLadder } from "../extract/ladder";
import { parseCount } from "../extract/parsers/count";
import { llmRung } from "../extract/rungs/llm";
import { savePage } from "../fetch/pageCache";
import { LlmError } from "../llm/client";
import { canonicalUrl } from "../libs/url";
import { fromSearch } from "./fields";
import { everyField, type FieldValue, type Item, type SourceAdapter } from "./types";

/** One web-search result and the query that found it. */
export const SearchHit = z.object({ url: z.string(), title: z.string(), description: z.string(), query: z.string() });
export type SearchHit = z.infer<typeof SearchHit>;

const SearchHitsParams = z.object({ site: z.string(), hits: z.array(SearchHit) });
type SearchHitsParams = z.infer<typeof SearchHitsParams>;

type Fact = { value: string; quote: string } | null;

const name = (hit: SearchHit): Fact => {
  const value = hit.title.split(/\s+[(|•·–-]|\s+@/)[0]!.trim();
  return value.length > 1 ? { value, quote: value } : null;
};
const handle = (hit: SearchHit): Fact => {
  const quote = /@[\w.]{2,30}/.exec(`${hit.title}\n${hit.description}`)?.[0];
  return quote ? { value: quote, quote } : null;
};
const followers = (hit: SearchHit): Fact => {
  const found = /(\d[\d,.]*\s*[KMB]?)\+?\s*(followers|subscribers)/i.exec(`${hit.title}\n${hit.description}`);
  const count = found && parseCount(found[1]!);
  return found && count !== null ? { value: String(count), quote: found[0] } : null;
};
/** The longest part of the snippet that isn't a count or the site's boilerplate. */
const bio = (hit: SearchHit): Fact => {
  const parts = hit.description.split(/\s+[·•|]\s+|\s+-\s+/).filter((p) => !/\b(followers|following|posts|photos|videos)\b/i.test(p));
  const value = parts.sort((a, b) => b.length - a.length)[0]?.trim();
  return value && value.length >= 15 ? { value, quote: value } : null;
};
const profileUrl = (hit: SearchHit): Fact => ({ value: hit.url, quote: hit.title });

/** Facts a profile's search result states in a predictable form, by the column words they answer. */
const FACTS: Array<[RegExp, (hit: SearchHit) => Fact]> = [
  [/\b(handle|username)\b/, handle],
  [/\b(followers?|subscribers?|audience)\b/, followers],
  [/\bname\b/, name],
  [/\b(profile|link|url)\b/, profileUrl],
  [/\b(bio|description|about)\b/, bio],
];

function factFor(field: FieldSpec): ((hit: SearchHit) => Fact) | undefined {
  if (field.catalogKey === "title") return name;
  if (field.catalogKey === "url") return profileUrl;
  const find = (text: string) => FACTS.find(([re]) => re.test(text.replace(/_/g, " ").toLowerCase()))?.[1];
  return find(field.name) ?? find(field.description);
}

/**
 * Public profiles on sites that forbid automated reading, known only from web-search results.
 * Each result becomes a record read from its title and snippet alone: predictable facts
 * (name, handle, follower count, bio) by pattern, other columns by the LLM with quotes checked
 * against the snippet. The snippet is stored as a page (via "search") for receipts; the
 * profile itself is never fetched.
 */
export const searchHits: SourceAdapter<SearchHitsParams> = {
  id: "search_hits",
  kind: "api",
  params: SearchHitsParams,
  provides: everyField("SEARCH"),

  async collect({ run }, { hits }) {
    if (!run) throw new Error("search_hits needs the run context for extraction");
    const fields = run.contract.fields.filter((f) => f.catalogKey !== "match_reason");
    let llmAvailable = true;
    const items: Item[] = [];

    for (const hit of hits) {
      const text = `${hit.title}\n${hit.description}`;
      const page = await savePage({ url: hit.url, finalUrl: hit.url, via: "search", status: 200, contentType: "text/plain", body: text });
      const source = { sourceUrl: hit.url, pageId: page.id };
      const filled: Record<string, FieldValue> = {};
      for (const field of fields) {
        const fact = factFor(field)?.(hit);
        const value = fact && fromSearch(fact.value, fact.quote, text, source);
        if (value) filled[field.name] = value;
      }

      const missing = fields.filter((f) => !filled[f.name]);
      if (missing.length && llmAvailable) {
        try {
          const found = await runLadder(run, { text, ...source }, missing, [llmRung]);
          for (const [field, value] of Object.entries(found)) filled[field] = { ...value, evidence: { ...value.evidence, method: "SEARCH" } };
        } catch (err) {
          if (!(err instanceof LlmError)) throw err;
          llmAvailable = false;
        }
      }

      const byKey = Object.fromEntries(Object.entries(filled).map(([field, value]) => [itemKeyFor(run.contract, field), value]));
      items.push({ externalId: canonicalUrl(hit.url) ?? hit.url, fields: byKey, text: { plain: text, ...source }, meta: { query: hit.query } });
    }
    return items;
  },
};
