import type { CheerioAPI } from "cheerio";

/**
 * Machine-readable data that pages carry alongside their markup: JSON-LD, and the state
 * blobs that JavaScript frameworks embed for hydration. Both are cheaper and more reliable
 * to read than rendered HTML.
 */

/** Every JSON-LD object on the page, with @graph arrays flattened. */
export function extractJsonLd($: CheerioAPI): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const parsed = parseJson($(el).text());
    for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
      if (!node || typeof node !== "object") continue;
      const graph = (node as { "@graph"?: unknown })["@graph"];
      if (Array.isArray(graph)) out.push(...graph.filter((g): g is Record<string, unknown> => Boolean(g) && typeof g === "object"));
      else out.push(node as Record<string, unknown>);
    }
  });
  return out;
}

/** JSON-LD objects of a given schema.org type, e.g. "JobPosting". */
export const jsonLdOfType = (items: Array<Record<string, unknown>>, type: string) =>
  items.filter((item) => {
    const t = item["@type"];
    return t === type || (Array.isArray(t) && t.includes(type));
  });

const ASSIGNMENT_KEYS = ["__appData", "__remixContext", "__INITIAL_STATE__", "__APOLLO_STATE__", "__NUXT__"];

/** Framework state embedded in scripts: __NEXT_DATA__ and `window.X = {...}` assignments. */
export function extractEmbedded($: CheerioAPI): Array<{ key: string; data: unknown }> {
  const out: Array<{ key: string; data: unknown }> = [];
  const next = $("script#__NEXT_DATA__").text();
  if (next) {
    const data = parseJson(next);
    if (data) out.push({ key: "__NEXT_DATA__", data });
  }
  $("script:not([src])").each((_, el) => {
    const source = $(el).text();
    for (const key of ASSIGNMENT_KEYS) {
      const at = source.indexOf(`${key} =`) >= 0 ? source.indexOf(`${key} =`) : source.indexOf(`${key}=`);
      if (at < 0) continue;
      const json = balancedObject(source, source.indexOf("{", at));
      const data = json ? parseJson(json) : null;
      if (data) out.push({ key, data });
    }
  });
  return out;
}

/** The `{...}` starting at `start`, found by brace matching (respecting strings). */
function balancedObject(source: string, start: number): string | null {
  if (start < 0) return null;
  let depth = 0;
  let inString: string | null = null;
  for (let i = start; i < source.length; i++) {
    const ch = source[i]!;
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === inString) inString = null;
    } else if (ch === '"' || ch === "'") inString = ch;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  return null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
