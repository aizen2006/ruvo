import { z } from "zod";

/**
 * One web-search result and the query that found it, with its date and engines when the search gave them.
 * Kept apart from the adapters that read hits, so a domain's adapter can take hits without importing extraction.
 */
export const SearchHit = z.object({
  url: z.string(),
  title: z.string(),
  description: z.string(),
  query: z.string(),
  publishedDate: z.string().optional(),
  engines: z.array(z.string()).optional(),
});
export type SearchHit = z.infer<typeof SearchHit>;
