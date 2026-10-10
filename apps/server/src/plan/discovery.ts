import type { DatasetContract, FoundSource } from "@repo/contracts";
import { docKindOf } from "../documents/kind";
import { packOf } from "../domains";
import { linkedDocument } from "../domains/documents/search";
import type { SourceCandidate, SourceLookUp } from "../domains/types";

/**
 * Chooses candidate sources for a contract without searching: pages (or PDF files) the user linked,
 * then the sources its domain knows (for jobs, the registry). Linked pages come first, so they are planned
 * (and run) before budgets are spent elsewhere. `lookUp` lets the domain look for more while a
 * run is prepared (see DomainPack.knownSources).
 */
export async function discoverSources(contract: DatasetContract, lookUp?: SourceLookUp): Promise<SourceCandidate[]> {
  const linked = contract.sourceHints.urls.map((url): SourceCandidate =>
    // A linked PDF is a document of its own, never read as a page.
    docKindOf(url)
      ? { ...foundCandidate(linkedDocument(url)), origin: "user_url" }
      : {
          ref: `html_list:${url}`,
          adapter: "html_list",
          label: new URL(url).host,
          params: { url },
          tags: [],
          jobCount: null,
          reason: "URL supplied by the user",
          origin: "user_url",
        },
  );
  return [...linked, ...((await packOf(contract).knownSources?.(contract, lookUp)) ?? [])];
}

/** A source web search found earlier, as a plannable candidate again (e.g. after a contract edit). */
export const foundCandidate = (found: FoundSource): SourceCandidate => ({ ...found, params: found.params as Record<string, unknown>, tags: [], jobCount: null, origin: "search" });
