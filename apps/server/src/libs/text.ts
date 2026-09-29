import * as cheerio from "cheerio";

const BLOCK_TAGS = "p, div, li, br, h1, h2, h3, h4, h5, h6, tr, section, article, ul, ol";

/**
 * Converts an HTML fragment to readable plain text, keeping block boundaries as newlines.
 * Entities are decoded, so the result can be matched against quotes and regexes.
 */
export function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  $(BLOCK_TAGS).each((_, el) => {
    $(el).prepend("\n").append("\n");
  });
  return normalizeWhitespace($.root().text());
}

/** Decodes HTML entities only (`&amp;lt;p&amp;gt;` → `<p>`), e.g. for APIs that return escaped HTML. */
export function decodeEntities(text: string): string {
  return cheerio.load(`<div>${text}</div>`)("div").text();
}

/** Collapses runs of spaces within lines and blank lines between them. */
export function normalizeWhitespace(text: string): string {
  return text
    .replace(/ /g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** Collapses all whitespace, line breaks included, to single spaces. */
export const singleLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** Shortens text to at most `max` characters on a word boundary, adding an ellipsis. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut}…`;
}
