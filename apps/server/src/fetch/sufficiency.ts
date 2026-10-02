import * as cheerio from "cheerio";

export interface Sufficiency {
  sufficient: boolean;
  /** Why the page needs a browser, for the escalation event. */
  reason: string | null;
  textLength: number;
}

const SPA_SHELL = [
  /<div[^>]+id=["'](root|app|__next|__nuxt|svelte)["'][^>]*>\s*<\/div>/i,
  /enable javascript|javascript is required|requires javascript/i,
];

/**
 * Decides whether an HTTP response already contains the page's content or is a
 * JavaScript shell that must be rendered in a browser.
 */
export function assessHtml(html: string): Sufficiency {
  const $ = cheerio.load(html);
  $("script, style, noscript, template, svg").remove();
  const textLength = $("body").text().replace(/\s+/g, " ").trim().length;

  if (textLength < 500) return { sufficient: false, reason: `only ${textLength} characters of text`, textLength };
  if (textLength < 2000 && SPA_SHELL.some((re) => re.test(html))) {
    return { sufficient: false, reason: "a JavaScript app shell with little text", textLength };
  }
  return { sufficient: true, reason: null, textLength };
}

const CHALLENGE_STATUS = new Set([403, 429, 503]);
// Cloudflare's challenge page. Not /cdn-cgi/challenge-platform/ or the Turnstile script: good pages carry those too.
const CHALLENGE_MARKERS = ["<title>Just a moment...</title>", "_cf_chl_opt", "cType: '"];

/** A bot check (e.g. Cloudflare's "Just a moment...") in place of the page, from any fetch method. */
export function isBotChallenge(status: number, headers: Record<string, string>, body: string): boolean {
  return CHALLENGE_STATUS.has(status) && (headers["cf-mitigated"] === "challenge" || hasChallengeMarkers(body));
}

/**
 * The bot check's markers in the page itself. A stealth browser result is judged by these alone:
 * Scrapling keeps the cf-mitigated header on a page it got past.
 */
export const hasChallengeMarkers = (body: string) => CHALLENGE_MARKERS.some((marker) => body.includes(marker));
