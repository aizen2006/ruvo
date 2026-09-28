/** Board slugs derived from company names (pure; shared by ATS detection and discovery). */

const SUFFIXES = /\b(inc|llc|ltd|corp|co|labs?|technologies|technology|hq|ai)\b\.?/g;

const wordsOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(Boolean);
const coreWordsOf = (name: string) => name.toLowerCase().replace(SUFFIXES, " ").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);

/**
 * Slugs that spell the whole name, with and without legal suffixes: "OpenAI Inc" → openaiinc,
 * openai-inc, openai. Safe for matching a named company to a registry entry.
 */
export function nameSlugs(name: string): string[] {
  const words = wordsOf(name);
  const core = coreWordsOf(name);
  return [...new Set([words.join(""), words.join("-"), core.join(""), core.join("-")].filter((v) => v.length >= 2))];
}

/** Likely board slugs for a company name, most likely first: "Scale AI" → scaleai, scale-ai, scale. */
export function slugVariants(name: string): string[] {
  return [...new Set([...nameSlugs(name), coreWordsOf(name)[0] ?? ""].filter((v) => v.length >= 2))];
}
