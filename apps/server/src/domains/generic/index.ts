import type { DatasetContract } from "@repo/contracts";
import { schemaRecordReader } from "../../extract/schemaOrg";
import type { DomainPack, NormalizeContext } from "../types";

/** Records found by searching the web need a search of their own when the model wrote none (and linked no page). */
export function searchForDescription(contract: DatasetContract, { warnings }: NormalizeContext): DatasetContract {
  const { searchQueries, urls } = contract.sourceHints;
  const fallback = contract.entityDescription.trim() || contract.title.trim();
  if (searchQueries.length > 0 || urls.length > 0 || !fallback) return contract;
  warnings.push("Added a search query from the dataset description, as none were given");
  return { ...contract, sourceHints: { ...contract.sourceHints, searchQueries: [fallback] } };
}

/** Any other kind of record (companies, people, creators, products, events…), read from pages that search finds. */
export const genericPack: DomainPack = {
  id: "generic",
  describe: "anything else (companies, people, creators, products, events, listings…)",
  fields: { title: "The item's name", url: "Its main link" },
  required: [],
  prompt: `Use "title" and "url" where they exist and "custom" for the rest (type "number" for counts and amounts), and require only the fields that identify an item.`,
  normalize: searchForDescription,
  jsonLd: [schemaRecordReader],
};
