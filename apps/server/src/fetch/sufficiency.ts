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
/**
 * Markers only a bot check's page carries: Cloudflare's challenge (not /cdn-cgi/challenge-platform/ or the Turnstile
 * script, which good pages carry too), DataDome's CAPTCHA host, PerimeterX's (HUMAN's) "press and hold" box, and
 * Akamai's denial page.
 */
const CHALLENGE_MARKERS = ["<title>Just a moment...</title>", "_cf_chl_opt", "cType: '", "captcha-delivery.com", 'id="px-captcha"', "<TITLE>Access Denied</TITLE>"];
/** reCAPTCHA and hCaptcha, a bot check only with a refusing status: good pages carry them in their forms. */
const CAPTCHA_MARKERS = ["google.com/recaptcha/", "recaptcha.net/recaptcha/", "hcaptcha.com/1/api.js"];
/**
 * Consent and login walls, which come with HTTP 200: Google's, YouTube's and Yahoo's consent forms, and LinkedIn's
 * sign-in wall (its page key; a link to the wall, which any page may carry, is not one).
 */
const WALL_MARKERS = ["consent.google.com/save", "consent.youtube.com/save", "collectConsent?sessionId=", 'content="auth_wall_'];

const hasAny = (body: string, markers: string[]) => markers.some((marker) => body.includes(marker));

/**
 * A bot check (e.g. Cloudflare's "Just a moment...") with a refusing status, or a consent or login wall, in place
 * of the page, from any fetch method.
 */
export function isBotChallenge(status: number, headers: Record<string, string>, body: string): boolean {
  if (hasAny(body, WALL_MARKERS)) return true;
  return CHALLENGE_STATUS.has(status) && (headers["cf-mitigated"] === "challenge" || hasAny(body, CHALLENGE_MARKERS) || hasAny(body, CAPTCHA_MARKERS));
}

/**
 * The markers of a bot check or wall in the page itself, whatever its status. A stealth browser result is judged
 * by these alone: Scrapling keeps the cf-mitigated header on a page it got past.
 */
export const hasChallengeMarkers = (body: string) => hasAny(body, CHALLENGE_MARKERS) || hasAny(body, WALL_MARKERS);
