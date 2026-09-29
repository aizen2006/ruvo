import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { singleLine } from "../libs/text";
import { findRepeatedGroups } from "./pageState";
import { selectAll } from "./selectors";
import { ancestorsOf } from "./similar";
import { describeElement, outline } from "./skeleton";

const NOISE = "script, style, noscript, template, svg, iframe, head";
/** Page chrome that does not hold records; dropped before pruning, as Crawl4AI does. */
const CHROME = "nav, footer, aside";

const GROUPS_SHOWN = 3;
const ITEMS_PER_GROUP = 2;
const MAX_BLOCK_CHARS = 400;

/**
 * A pruned, relevance-ranked outline of a page for LLM prompts, after Crawl4AI's fit markdown:
 *   1. the page's top repeated groups (where list pages keep their records), two items each
 *   2. the content blocks that survive pruning by text density, link density and tag weight,
 *      those sharing the most words with `query` first
 * cut at `maxChars`. It replaces a blind cut of the page outline, which on long pages often
 * ends before the records begin.
 */
export function fitText(html: string, query: string, maxChars = 8_000): string {
  const $ = cheerio.load(html);
  $(NOISE).remove();
  $(CHROME).remove();
  const body = $("body").get(0);
  if (!body) return "";

  const parts: string[] = [];
  let size = 0;
  const add = (part: string) => {
    if (size + part.length > maxChars) return false;
    parts.push(part);
    size += part.length + 1;
    return true;
  };

  // Groups nested in, or wrapped around, a better-ranked group would repeat its items.
  const shown = new Set<Element>();
  const wrappers = new Set<Element>();
  for (const group of findRepeatedGroups($, GROUPS_SHOWN)) {
    const items = selectAll($, group.selector);
    if (items.length === 0 || items.some((el) => shown.has(el) || wrappers.has(el) || ancestorsOf(el).some((a) => shown.has(a)))) continue;
    for (const el of items) {
      shown.add(el);
      for (const ancestor of ancestorsOf(el)) wrappers.add(ancestor);
    }
    const samples = items.slice(0, ITEMS_PER_GROUP).map((el) => outline([el], maxChars / 4));
    add(`## ${items.length} similar items (${group.selector}), the first ${samples.length}:\n${samples.join("\n")}`);
  }

  const relevance = relevanceTo(query);
  const ranked = contentBlocks(body, shown)
    .map((block) => ({ ...block, relevance: relevance(block.text) }))
    .sort((a, b) => b.relevance - a.relevance || b.score - a.score);
  const lines: string[] = [];
  for (const block of ranked) {
    const text = block.text.slice(0, MAX_BLOCK_CHARS);
    const line = describeElement(block.el, text);
    if (size + line.length > maxChars) break;
    lines.push(line);
    size += line.length + 1;
  }
  if (lines.length) parts.push("## Other content, most relevant first:", ...lines);
  return parts.join("\n");
}


// --- Pruning (Crawl4AI's PruningContentFilter) ---

const PRUNE_THRESHOLD = 0.48;
const WEIGHTS = { textDensity: 0.4, linkDensity: 0.2, tag: 0.2, classId: 0.1, textLength: 0.1 };
const TAG_WEIGHTS: Record<string, number> = {
  div: 0.5, p: 1, article: 1.5, section: 1, span: 0.3, li: 0.5, ul: 0.5, ol: 0.5, h1: 1.2, h2: 1.1, h3: 1, h4: 0.9, h5: 0.8, h6: 0.7,
};
const NEGATIVE_CLASS_ID = /^(nav|footer|header|sidebar|ads|comment|promo|advert|social|share)/i;
const BLOCK_TAGS = new Set([
  "address", "article", "blockquote", "dd", "div", "dl", "dt", "figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6",
  "header", "li", "main", "ol", "p", "pre", "section", "table", "tbody", "td", "th", "thead", "tr", "ul",
]);

interface Metrics {
  text: number;
  markup: number;
  linkText: number;
}

/**
 * Block elements whose subtree passes pruning, each with its own inline text (text in nested
 * blocks belongs to those). Items already shown in a repeated group are skipped.
 */
function contentBlocks(body: Element, shown: Set<Element>): Array<{ el: Element; text: string; score: number }> {
  const metrics = new Map<Element, Metrics>();
  measure(body, metrics);
  const blocks: Array<{ el: Element; text: string; score: number }> = [];
  const visit = (el: Element) => {
    for (const child of el.children) {
      if (child.type !== "tag" || shown.has(child)) continue;
      const score = pruneScore(child, metrics.get(child)!);
      if (score < PRUNE_THRESHOLD) continue;
      if (BLOCK_TAGS.has(child.tagName)) {
        const text = singleLine(inlineText(child));
        if (text) blocks.push({ el: child, text, score });
      }
      visit(child);
    }
  };
  visit(body);
  return blocks;
}

/** Text length, approximate markup length and link text length of each element, bottom up. */
function measure(el: Element, into: Map<Element, Metrics>): Metrics {
  const own = { text: 0, markup: 2 * el.tagName.length + 5, linkText: 0 };
  for (const [name, value] of Object.entries(el.attribs)) own.markup += name.length + value.length + 4;
  for (const child of el.children) {
    if (child.type === "text") {
      own.text += child.data.trim().length;
      own.markup += child.data.length;
    } else if (child.type === "tag") {
      const m = measure(child, into);
      own.text += m.text;
      own.markup += m.markup;
      own.linkText += m.linkText;
    }
  }
  if (el.tagName === "a") own.linkText = own.text;
  into.set(el, own);
  return own;
}

function pruneScore(el: Element, m: Metrics): number {
  const textDensity = m.markup ? m.text / m.markup : 0;
  const linkDensity = m.text ? m.linkText / m.text : 0;
  const classId = [el.attribs.class, el.attribs.id].filter((v) => v && NEGATIVE_CLASS_ID.test(v)).length * -0.5;
  return (
    WEIGHTS.textDensity * textDensity +
    WEIGHTS.linkDensity * (1 - linkDensity) +
    WEIGHTS.tag * (TAG_WEIGHTS[el.tagName] ?? 0.5) +
    WEIGHTS.classId * classId +
    WEIGHTS.textLength * Math.log(m.text + 1)
  );
}

/** Text under `el`, except text inside nested blocks (which belongs to those blocks). */
function inlineText(el: Element): string {
  return el.children
    .map((child) => {
      if (child.type === "text") return child.data;
      if (child.type === "tag" && !BLOCK_TAGS.has(child.tagName)) return ` ${inlineText(child)} `;
      return " ";
    })
    .join("");
}

// --- Ranking ---

const STOPWORDS = new Set(["a", "an", "and", "are", "as", "at", "by", "for", "from", "in", "is", "of", "on", "or", "the", "to", "with"]);
const terms = (text: string) => new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => !STOPWORDS.has(t)));

/** How many of the query's words a text contains. */
function relevanceTo(query: string): (text: string) => number {
  const wanted = terms(query);
  return (text) => [...terms(text)].filter((t) => wanted.has(t)).length;
}
