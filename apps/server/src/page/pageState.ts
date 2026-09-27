import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import { sha256 } from "../libs/hash";
import { normalizeWhitespace } from "../libs/text";
import { absoluteUrl } from "../libs/url";
import { elementSelector, elementSignature } from "./selectors";
import { extractEmbedded, extractJsonLd } from "./structured";

/** A compact, consistent view of one page that every later stage works from. */
export interface PageState {
  url: string;
  title: string;
  text: string;
  textLength: number;
  headings: string[];
  links: Array<{ text: string; href: string }>;
  /** Runs of same-shaped siblings (e.g. job cards), best candidates first. */
  groups: RepeatedGroup[];
  jsonLd: Array<Record<string, unknown>>;
  embedded: Array<{ key: string; data: unknown }>;
  contentHash: string;
}

export interface RepeatedGroup {
  /** Selector matching the items of the group. */
  selector: string;
  count: number;
  linkCount: number;
  /** Relies on generated class names, so likely to break when the site is rebuilt. */
  fragile: boolean;
  samples: string[];
}

const MAX_TEXT = 20_000;
const MAX_LINKS = 300;
const NOISE = "script, style, noscript, template, svg, iframe";

export function toPageState(html: string, url: string): PageState {
  const $ = cheerio.load(html);
  const jsonLd = extractJsonLd($);
  const embedded = extractEmbedded($);
  $(NOISE).remove();

  const text = normalizeWhitespace($("body").text());
  const links: PageState["links"] = [];
  $("a[href]").each((_, el) => {
    const href = absoluteUrl($(el).attr("href")!, url);
    const label = normalizeWhitespace($(el).text()) || $(el).attr("aria-label") || "";
    if (href && links.length < MAX_LINKS) links.push({ text: label.slice(0, 120), href });
  });

  return {
    url,
    title: normalizeWhitespace($("title").first().text()),
    text: text.slice(0, MAX_TEXT),
    textLength: text.length,
    headings: $("h1, h2, h3")
      .map((_, el) => normalizeWhitespace($(el).text()))
      .get()
      .filter(Boolean)
      .slice(0, 40),
    links,
    groups: findRepeatedGroups($),
    jsonLd,
    embedded,
    contentHash: sha256(html),
  };
}

/**
 * Finds runs of at least 3 siblings with the same signature. Groups with more items,
 * links and text rank first; that is where list pages keep their records.
 */
export function findRepeatedGroups($: CheerioAPI, limit = 5): RepeatedGroup[] {
  const groups: Array<RepeatedGroup & { score: number }> = [];
  $("body *").each((_, parent) => {
    const children = $(parent).children().toArray() as Element[];
    if (children.length < 3) return;
    const bySignature = new Map<string, Element[]>();
    for (const child of children) {
      const sig = elementSignature(child);
      bySignature.set(sig, [...(bySignature.get(sig) ?? []), child]);
    }
    for (const [, items] of bySignature) {
      if (items.length < 3) continue;
      const texts = items.map((el) => normalizeWhitespace($(el).text()));
      const avgText = texts.reduce((n, t) => n + t.length, 0) / items.length;
      if (avgText < 8) continue;
      const linkCount = items.filter((el) => $(el).is("a[href]") || $(el).find("a[href]").length > 0).length;
      const parentSel = elementSelector(parent as Element);
      const itemSel = elementSelector(items[0]!);
      groups.push({
        selector: `${parentSel.selector} > ${itemSel.selector}`,
        count: items.length,
        linkCount,
        fragile: parentSel.fragile || itemSel.fragile,
        samples: texts.slice(0, 3).map((t) => t.slice(0, 160)),
        score: groupScore(items.length, avgText, linkCount, itemSel.selector, parentSel.fragile || itemSel.fragile),
      });
    }
  });
  return groups
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score: _score, ...group }) => group);
}

/**
 * Ranks groups for "is this the record list?": more items and more text help, most of all
 * when nearly every item links somewhere. Bare-tag items (layout wrappers) and generated
 * class names count against a group.
 */
function groupScore(count: number, avgText: number, linkCount: number, itemSelector: string, fragile: boolean): number {
  const linkRatio = linkCount / count;
  const bareTag = /^[a-z0-9]+$/.test(itemSelector);
  return count * Math.min(avgText, 200) * (0.5 + linkRatio) * (bareTag ? 0.3 : 1) * (fragile ? 0.8 : 1);
}
