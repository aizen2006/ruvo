/** Query parameters that only track where a click came from, besides every utm_ one; they never identify a page. */
const TRACKING_PARAMS = new Set([
  // job boards
  "gh_src", "lever-origin", "lever-source", "lever-source[]", "ref",
  // ad, search and social click ids
  "fbclid", "gclid", "gclsrc", "dclid", "gbraid", "wbraid", "msclkid", "yclid", "twclid", "ttclid", "li_fat_id", "igshid", "si", "srsltid",
  // email and analytics links
  "mc_cid", "mc_eid", "_hsenc", "_hsmi", "mkt_tok", "_ga", "_gl",
]);
const isTracking = (param: string) => param.toLowerCase().startsWith("utm_") || TRACKING_PARAMS.has(param.toLowerCase());

/** Hosts that serve the same pages under several names. */
const HOST_ALIASES: Record<string, string> = {
  "boards.greenhouse.io": "job-boards.greenhouse.io",
};

/**
 * Normalizes a URL so the same page always yields the same string: lowercase host
 * without www, host aliases unified, tracking params and fragments removed, remaining
 * params sorted, no trailing slash, and Lever's `/apply` suffix dropped.
 * Returns null for anything that isn't an absolute http(s) URL.
 */
export function canonicalUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  url.hostname = HOST_ALIASES[host] ?? host;
  url.protocol = "https:";
  url.hash = "";

  const params = [...url.searchParams.entries()]
    .filter(([key]) => !isTracking(key))
    .sort(([a], [b]) => a.localeCompare(b));
  url.search = new URLSearchParams(params).toString();

  let path = url.pathname.replace(/\/+$/, "");
  if (url.hostname === "jobs.lever.co") path = path.replace(/\/apply$/, "");
  url.pathname = path || "/";

  return url.href.replace(/\/(\?|$)/, "$1");
}

/** Resolves a possibly-relative href against the page it appeared on. */
export function absoluteUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

/**
 * The address a page declares as its canonical one (its rel=canonical href, resolved against the page) when it is
 * on the page's own host, www or not; null otherwise, since another site's address does not identify this page.
 */
export function sameSiteCanonical(href: string | undefined, pageUrl: string): string | null {
  const declared = href ? absoluteUrl(href, pageUrl) : null;
  const canonical = declared && canonicalUrl(declared);
  const page = canonicalUrl(pageUrl);
  return canonical && page && new URL(canonical).host === new URL(page).host ? declared : null;
}

export const hostOf = (raw: string) => {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
};
