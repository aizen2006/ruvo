import type { DatasetContract } from "@repo/contracts";
import { z } from "zod";
import { derived, fromDocMeta, fromSearch } from "../../adapters/fields";
import type { SourceAdapter } from "../../adapters/types";
import { itemKeyFor, type FieldValue, type Item } from "../../core/items";
import { FetchError } from "../../fetch/errors";
import type { HeadResult } from "../../fetch/fetcher";
import { savePage } from "../../fetch/pageCache";
import { compileKeywords } from "../../libs/keywords";
import { mapLimit } from "../../libs/limit";
import { canonicalUrl, hostOf } from "../../libs/url";
import { SearchHit } from "../../search/hit";
import { DOCUMENT_FIELDS } from "./fields";
import { DOCUMENT_ADAPTER } from "./search";

/** HEAD requests a source makes at once. */
const HEAD_CONCURRENCY = 3;

const DocumentHitsParams = z.object({ hits: z.array(SearchHit) });
type DocumentHitsParams = z.infer<typeof DocumentHitsParams>;

type Fact = { value: string; quote: string } | null;

const fact = (value: string | null | undefined, quote: string | null | undefined): Fact => (value && quote ? { value, quote } : null);

/** Search engines mark files in their titles ("[PDF] Guide", "Guide (PDF)", "Guide - PDF", "guide.pdf"); the title is what's left. */
const cleanTitle = (title: string) => title.replace(/^\s*\[PDF\]\s*|\s*\(PDF\)\s*$|\s+[-–|]\s+PDF\s*$|\.pdf\s*$/gi, "").trim();

/** A title from a file's name: "Voice_SDK-Manual.pdf" reads "Voice SDK Manual". */
const titleOfName = (name: string | null | undefined) => (name ? cleanTitle(name).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() : null);

/** The file name at the end of a link, decoded; null when the link ends in a folder. */
function linkFileName(url: string): string | null {
  const last = URL.canParse(url) ? new URL(url).pathname.split("/").pop() : null;
  if (!last) return null;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** A date as RUVO keeps it (YYYY-MM-DD): an ISO one as written, any other (an HTTP date) read in UTC. */
function isoDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const date = new Date(raw);
  return /^\d{4}-\d{2}-\d{2}/.exec(raw)?.[0] ?? (Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10));
}

const PDF_LINK = /\.pdf(?=$|[?#])/i;

/** What a file's search result says, by catalog key, with the words that say it; author stays empty. */
const FACTS: Record<string, (hit: SearchHit) => Fact> = {
  title: (hit) => fact(cleanTitle(hit.title), cleanTitle(hit.title)),
  url: (hit) => fact(hit.url, hit.url),
  site: (hit) => {
    const site = hostOf(hit.url)?.replace(/^www\./, "");
    return fact(site, site);
  },
  published: (hit) => fact(isoDate(hit.publishedDate), hit.publishedDate),
  file_type: (hit) => fact("PDF", PDF_LINK.exec(hit.url)?.[0]),
  pages: (hit) => {
    const found = /\b(\d{1,4})\s+pages?\b/i.exec(hit.description);
    return fact(found?.[1], found?.[0]);
  },
  summary: (hit) => fact(hit.description.trim(), hit.description.trim()),
};

/** A search result as text, stored for receipts: everything a value quotes. */
const resultText = (hit: SearchHit) => [hit.title, hit.url, hit.description, hit.publishedDate && `Published ${hit.publishedDate}`].filter(Boolean).join("\n");

/** A lead from a file's search result alone (see FACTS), the result stored as a page (via "search") for receipts. */
async function leadOf(contract: DatasetContract, hit: SearchHit): Promise<Item> {
  const text = resultText(hit);
  const page = await savePage({ url: hit.url, finalUrl: hit.url, via: "search", status: 200, contentType: "text/plain", body: text });
  const source = { sourceUrl: hit.url, pageId: page.id };
  const fields: Record<string, FieldValue> = {};
  for (const { catalogKey } of contract.fields) {
    const found = Object.hasOwn(FACTS, catalogKey) ? FACTS[catalogKey]!(hit) : null;
    const value = found && fromSearch(found.value, found.quote, text, source);
    if (value) fields[catalogKey] = value;
  }
  // A linked file has no search result: until its headers name it, its title is the file name in its link.
  if (!fields.title && contract.fields.some((f) => f.catalogKey === "title")) {
    const title = derived(titleOfName(linkFileName(hit.url)), hit.url, "the file name in its link", hit.url, page.id);
    if (title) fields.title = title;
  }
  return { externalId: canonicalUrl(hit.url) ?? hit.url, fields, text: { plain: text, ...source }, meta: { query: hit.query } };
}

/** Whether a lead passes the contract's hard keyword rules, as the prefilter will judge it: a file it drops isn't worth a request. */
function passesTriage(contract: DatasetContract, lead: Item): boolean {
  const hard = contract.criteria.filter((c) => c.strength === "hard");
  const found = (kind: "keyword_any" | "keyword_none") => {
    const criteria = hard.filter((c) => c.kind === kind);
    const text = criteria.flatMap((c) => c.fields).map((f) => String(lead.fields[itemKeyFor(contract, f)]?.value ?? "")).join("\n");
    return compileKeywords(criteria.flatMap((c) => c.values))?.test(text);
  };
  return found("keyword_any") !== false && found("keyword_none") !== true;
}

/**
 * What a file's headers (HEAD) add to its lead, as DOC_META values: its type, its size, its Last-Modified
 * date when search gave none, and its filename when search gave no title. Null when the address serves
 * a page, not a document; no answer, or an error status, adds nothing.
 */
function withHead(contract: DatasetContract, url: string, lead: Item, res: HeadResult | null): Item | null {
  if (!res || res.status < 200 || res.status > 299) return lead;
  if (/^(text\/html|application\/xhtml\+xml)\b/i.test(res.contentType ?? "")) return null;

  const source = { sourceUrl: url, pageId: null };
  const typed = /^application\/pdf\b/i.test(res.contentType ?? "");
  const sniffed = !typed && PDF_LINK.test(res.finalUrl);
  const details: Record<string, FieldValue | undefined> = {
    file_type: typed || sniffed ? fromDocMeta("PDF", typed ? "Content-Type" : "URL", typed ? `Content-Type: ${res.contentType}` : res.finalUrl, source) : undefined,
    size_bytes: fromDocMeta(res.contentLength, "Content-Length", `Content-Length: ${res.contentLength}`, source),
    published: lead.fields.published ? undefined : fromDocMeta(isoDate(res.lastModified), "Last-Modified", `Last-Modified: ${res.lastModified}`, source),
    // The headers' file name beats one taken from the link, never a search result's title.
    title: lead.fields.title?.evidence.method === "SEARCH" ? undefined : fromDocMeta(titleOfName(res.filename), "filename", res.filename ?? "", source),
  };
  const keys = new Set(contract.fields.map((f) => f.catalogKey));
  const added = Object.entries(details).filter((e): e is [string, FieldValue] => e[1] !== undefined && keys.has(e[0]));
  return { ...lead, fields: { ...lead.fields, ...Object.fromEntries(added) } };
}

/**
 * Documents known from web search results (or a link the user gave), one record per file, read from
 * what the result says; the leads that pass triage also get the file's headers (a HEAD request, a few
 * at a time), and an address that turns out to serve a page is dropped. No file is downloaded.
 */
export const documentHits: SourceAdapter<DocumentHitsParams> = {
  id: DOCUMENT_ADAPTER,
  kind: "api",
  params: DocumentHitsParams,
  // Every catalog field, so nothing is left for an enrich step to fetch; the size only comes from the headers.
  provides: {
    ...Object.fromEntries(Object.keys(DOCUMENT_FIELDS).filter((k) => k !== "match_reason").map((k) => [k, "SEARCH" as const])),
    size_bytes: "DOC_META",
  },

  async collect({ fetcher, scope, run }, { hits }) {
    if (!run) throw new Error(`${DOCUMENT_ADAPTER} needs the run context for its contract`);
    const leads: Item[] = [];
    for (const hit of hits) leads.push(await leadOf(run.contract, hit));

    const checked = await mapLimit(leads, HEAD_CONCURRENCY, async (lead, i) => {
      if (!passesTriage(run.contract, lead)) return lead;
      const url = hits[i]!.url;
      try {
        return withHead(run.contract, url, lead, await fetcher.head(scope, url));
      } catch (err) {
        // A refused or failed request (robots.txt, a bot check, an error status) leaves the lead as search found it.
        if (err instanceof FetchError) return lead;
        throw err;
      }
    });
    return checked.filter((lead): lead is Item => lead !== null);
  },
};
