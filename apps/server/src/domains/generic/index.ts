import type { DomainPack } from "../types";

/** Any other kind of record (companies, people, creators, products, events…), read from pages that search finds. */
export const genericPack: DomainPack = {
  id: "other",
  describe: "anything else (companies, people, creators, products, events, listings…)",
  fields: { title: "The item's name", url: "Its main link" },
  required: [],
  prompt: `Use "title" and "url" where they exist and "custom" for the rest (type "number" for counts and amounts), and require only the fields that identify an item.`,
};
