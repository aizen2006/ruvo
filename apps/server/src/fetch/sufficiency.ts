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
