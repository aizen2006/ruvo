/** Query parameters that only track where a click came from; they never identify a job. */
const TRACKING_PARAMS = /^(utm_.*|gh_src|lever-origin|lever-source(\[\])?|ref|fbclid|gclid|mc_cid|mc_eid)$/i;

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
    .filter(([key]) => !TRACKING_PARAMS.test(key))
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

export const hostOf = (raw: string) => {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
};
