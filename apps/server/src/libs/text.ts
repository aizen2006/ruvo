import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";

const BLOCK_TAGS = "p, div, li, br, h1, h2, h3, h4, h5, h6, tr, section, article, ul, ol";
/** An inline style that hides its element. */
const HIDING_STYLE = /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i;

/**
 * Removes what a visitor never sees: templates, and elements that are hidden, aria-hidden or
 * hidden by an inline style. Text planted there must not reach extraction or a prompt.
 */
export function removeHidden($: CheerioAPI): void {
  $('template, [hidden], [aria-hidden="true" i]').remove();
  $("[style]")
    .filter((_, el) => HIDING_STYLE.test($(el).attr("style") ?? ""))
    .remove();
}

/**
 * Converts an HTML fragment to readable plain text, keeping block boundaries as newlines.
 * Entities are decoded, so the result can be matched against quotes and regexes.
 */
export function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  removeHidden($);
  $(BLOCK_TAGS).each((_, el) => {
    $(el).prepend("\n").append("\n");
  });
  return normalizeWhitespace($.root().text());
}

/** Decodes HTML entities only (`&amp;lt;p&amp;gt;` → `<p>`), e.g. for APIs that return escaped HTML. */
export function decodeEntities(text: string): string {
  return cheerio.load(`<div>${text}</div>`)("div").text();
}

/** Zero-width and bidirectional control characters: unseen, yet they split words and can reorder what a reader sees. */
export const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/g;

/**
 * Text in one Unicode form (NFKC: "ﬁ" → "fi", full-width "Ｒ" → "R", a no-break space → a space)
 * without invisible characters, so quotes and keywords match however a page encoded them.
 */
export const normalizeChars = (text: string) => text.normalize("NFKC").replace(INVISIBLE, "");

/** Collapses runs of spaces within lines and blank lines between them, after normalizeChars. */
export function normalizeWhitespace(text: string): string {
  return normalizeChars(text)
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** Collapses all whitespace, line breaks included, to single spaces, after normalizeChars. */
export const singleLine = (text: string) => normalizeChars(text).replace(/\s+/g, " ").trim();

/** Shortens text to at most `max` characters on a word boundary, adding an ellipsis. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut}…`;
}
