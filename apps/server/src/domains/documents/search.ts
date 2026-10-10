import type { FoundSource } from "@repo/contracts";
import type { SearchHit } from "../../adapters/searchHits";
import { docKindOf } from "../../documents/kind";
import type { PackSearch } from "../types";

/** The adapter that reads documents from what their search results say, never downloading them. */
export const DOCUMENT_ADAPTER = "document_hits";

/** A search without the PDF filter the pack's own searches add, so both searches of a query share a source. */
const baseQuery = (query: string) => query.replace(/\s*\bfiletype:pdf\b/gi, "").trim();

/** The PDF files one search found, as one source: its files are judged together, a batch or two per source. */
function searchSource(query: string, hits: SearchHit[]): FoundSource {
  const files = `${hits.length} PDF file${hits.length === 1 ? "" : "s"}`;
  return {
    ref: `${DOCUMENT_ADAPTER}:${query}`,
    adapter: DOCUMENT_ADAPTER,
    label: `PDF files for "${query}"`,
    params: { hits },
    reason: `${files} in the results of searching "${query}". Only what the results say about each file is used; the files are never downloaded.`,
  };
}

/** A PDF file the user linked, as a source of its own: read from its link and headers, never downloaded. */
export function linkedDocument(url: string): FoundSource {
  return {
    ref: `${DOCUMENT_ADAPTER}:${url}`,
    adapter: DOCUMENT_ADAPTER,
    label: `${new URL(url).host}${new URL(url).pathname}`,
    params: { hits: [{ url, title: "", description: "", query: "" }] },
    reason: "PDF file linked by the user, read from its link and headers without downloading it",
  };
}

/**
 * Search rounds also look for PDF files: each of a round's queries again with filetype:pdf. Every PDF a
 * round's searches found is the pack's own, never read as a page, and joins its query's source.
 */
export const documentSearch: PackSearch = {
  // Sources are searches, a dozen or two files each; the first round's queries alone fill Quick's and Balanced's.
  maxNew: { quick: 3, balanced: 6, thorough: 12 },
  queries: (_contract, queries) => queries.filter((q) => !/\bfiletype:/i.test(q)).map((q) => `${q} filetype:pdf`),
  recognize: (hit) => docKindOf(hit.url) !== null,
  async sources(_contract, hits, { seen, max }) {
    const byQuery = new Map<string, SearchHit[]>();
    const urls = new Set<string>();
    for (const hit of hits) {
      // A file both searches of a query found is one file.
      if (!docKindOf(hit.url) || urls.has(hit.url)) continue;
      urls.add(hit.url);
      const query = baseQuery(hit.query);
      byQuery.set(query, [...(byQuery.get(query) ?? []), hit]);
    }
    return [...byQuery].map(([query, found]) => searchSource(query, found)).filter((s) => !seen.has(s.ref)).slice(0, max);
  },
  summarize(sources) {
    const files = sources.reduce((n, s) => n + (s.params as { hits: SearchHit[] }).hits.length, 0);
    return `${files} PDF file${files === 1 ? "" : "s"} from ${sources.length} search${sources.length === 1 ? "" : "es"}`;
  },
};
