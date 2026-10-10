import type { DatasetContract } from "@repo/contracts";
import type { SourceAdapter } from "../../adapters/types";
import { searchForDescription } from "../generic";
import type { DomainPack, NormalizeContext } from "../types";
import { documentHits } from "./adapter";
import { DOCUMENT_FIELDS } from "./fields";
import { documentSearch } from "./search";

/** Search results rarely say who wrote a file or how long it is, so no record needs these. */
const OFTEN_UNKNOWN: ReadonlySet<string> = new Set(["author", "pages", "size_bytes"]);

/**
 * The documents domain's defaults after the compiler: a search of its own when none was written, the
 * details search results rarely give made optional, and one document per link (reports often share a title).
 */
export function normalizeDocuments(contract: DatasetContract, context: NormalizeContext): DatasetContract {
  const searched = searchForDescription(contract, context);
  const fields = searched.fields.map((f) => {
    if (!f.required || !OFTEN_UNKNOWN.has(f.catalogKey)) return f;
    context.warnings.push(`Made "${f.name}" optional: search results rarely state it`);
    return { ...f, required: false };
  });
  return { ...searched, fields, dedupKeys: searched.dedupKeys.length ? searched.dedupKeys : [["url"]] };
}

/** Documents themselves (PDFs for now), found by web search and read from their search results, never downloaded. */
export const documentsPack: DomainPack = {
  id: "documents",
  describe: "requests for documents to read or download (PDFs, papers, reports, guides, manuals, whitepapers, documentation), on any topic",
  fields: DOCUMENT_FIELDS,
  required: ["title", "url"],
  prompt: `Choose this domain whenever the user wants documents themselves: "PDF reports about X" or "documentation on using voice model APIs" ask for documents about a topic, not for records of it.
RUVO reads only what web search results say about each file (title, link, snippet, date), never the file itself, so author, pages and size are often empty: never make them required.
semantic: add one hard criterion asking whether the document is about the request's topic, e.g. "Is this document about using voice model APIs?". RUVO finds only PDF files for now, so never add a criterion on the file type.
searchQueries: 3-6 queries that would find the documents themselves, as a person would search for them (e.g. "voice model API documentation", "speech API developer guide"); RUVO also searches for PDF files with each one.`,
  normalize: normalizeDocuments,
  adapters: [documentHits] as SourceAdapter<unknown>[],
  search: documentSearch,
};
