import type { CheerioAPI } from "cheerio";
import type { Element } from "domhandler";

/**
 * CSS-selector helpers that prefer stable hooks (data-* test/ui attributes, ids, semantic
 * class names) over generated class names, which change whenever a site is rebuilt.
 */

const STABLE_ATTRS = ["data-ui", "data-testid", "data-test", "data-qa", "data-automation-id", "itemprop"];

/** Class names produced by CSS modules / CSS-in-JS: "styles--1vo9F", "css-1x2y3z", "sc-bdVaJa", "Card_root__a1B2c". */
export function isGeneratedClass(name: string): boolean {
  return (
    /^(css|sc|jsx|emotion|svelte|tw)-[A-Za-z0-9]{3,}/.test(name) ||
    /--[A-Za-z0-9_-]{4,}$/.test(name) ||
    /__[A-Za-z0-9]{5}$/.test(name) ||
    /^[a-z]{1,3}[A-Z0-9][A-Za-z0-9]{4,}$/.test(name)
  );
}

/** Class names a plain `.name` selector can express ("md:flex" and "w-1/2" cannot). */
export const isPlainClassName = (name: string) => /^-?[_a-zA-Z][\w-]*$/.test(name);

/** Elements matching a selector (inside `within`, if given); a selector the parser rejects matches nothing. */
export function selectAll($: CheerioAPI, selector: string, within?: Element): Element[] {
  try {
    return (within ? $(within).find(selector) : $(selector)).toArray() as Element[];
  } catch {
    return [];
  }
}

const escapeCss = (value: string) => value.replace(/(["\\])/g, "\\$1");

/** The most stable selector for one element (without ancestors). `fragile` marks generated-class fallbacks. */
export function elementSelector(el: Element): { selector: string; fragile: boolean } {
  const tag = el.tagName.toLowerCase();
  for (const attr of STABLE_ATTRS) {
    const value = el.attribs[attr];
    if (value) return { selector: `${tag}[${attr}="${escapeCss(value)}"]`, fragile: false };
  }
  const classes = (el.attribs.class ?? "").split(/\s+/).filter(isPlainClassName);
  const semantic = classes.filter((c) => !isGeneratedClass(c));
  if (semantic.length) return { selector: `${tag}.${semantic.slice(0, 2).join(".")}`, fragile: false };
  if (el.attribs.role) return { selector: `${tag}[role="${escapeCss(el.attribs.role)}"]`, fragile: false };
  if (classes.length) return { selector: `${tag}.${classes[0]}`, fragile: true };
  return { selector: tag, fragile: false };
}

/** Signature used to decide whether siblings are "the same kind" of element. */
export const elementSignature = (el: Element) => elementSelector(el).selector;
