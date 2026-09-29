import type { CheerioAPI } from "cheerio";
import type { Element } from "domhandler";

/**
 * Element similarity, ported from Scrapling: `findSimilar` (its `find_similar`) and the
 * Ratcliff/Obershelp `sequenceRatio` it and element relocation are built on.
 */

type Sequence = string | readonly string[];

/**
 * Python's `difflib.SequenceMatcher(None, a, b).ratio()`, autojunk included: 2·M / (|a| + |b|),
 * where M counts the characters (or array items) in the recursively found longest matching
 * blocks. Strings are compared by code point, as Python does.
 */
export function sequenceRatio(a: Sequence, b: Sequence): number {
  const left = typeof a === "string" ? Array.from(a) : a;
  const right = typeof b === "string" ? Array.from(b) : b;
  const total = left.length + right.length;
  return total === 0 ? 1 : (2 * matchingCharacters(left, right)) / total;
}

function matchingCharacters(a: readonly string[], b: readonly string[]): number {
  const b2j = indexOfElements(b);
  let matched = 0;
  const queue: Array<[number, number, number, number]> = [[0, a.length, 0, b.length]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop()!;
    const [i, j, k] = longestMatch(a, b, b2j, alo, ahi, blo, bhi);
    if (!k) continue;
    matched += k;
    if (alo < i && blo < j) queue.push([alo, i, blo, j]);
    if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
  }
  return matched;
}

/**
 * Positions of each element of `b`. With 200+ elements, "popular" ones (more than 1% + 1 of
 * the positions) are left out, as difflib's autojunk heuristic does.
 */
function indexOfElements(b: readonly string[]): Map<string, number[]> {
  const b2j = new Map<string, number[]>();
  b.forEach((elt, i) => {
    const indices = b2j.get(elt);
    if (indices) indices.push(i);
    else b2j.set(elt, [i]);
  });
  if (b.length >= 200) {
    const limit = Math.floor(b.length / 100) + 1;
    for (const [elt, indices] of b2j) if (indices.length > limit) b2j.delete(elt);
  }
  return b2j;
}

/** difflib's `find_longest_match` with no junk function: popular elements only extend a match. */
function longestMatch(a: readonly string[], b: readonly string[], b2j: Map<string, number[]>, alo: number, ahi: number, blo: number, bhi: number) {
  let [besti, bestj, bestsize] = [alo, blo, 0];
  let j2len = new Map<number, number>();
  for (let i = alo; i < ahi; i++) {
    const next = new Map<number, number>();
    for (const j of b2j.get(a[i]!) ?? []) {
      if (j < blo) continue;
      if (j >= bhi) break;
      const k = (j2len.get(j - 1) ?? 0) + 1;
      next.set(j, k);
      if (k > bestsize) [besti, bestj, bestsize] = [i - k + 1, j - k + 1, k];
    }
    j2len = next;
  }
  while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) [besti, bestj, bestsize] = [besti - 1, bestj - 1, bestsize + 1];
  while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) bestsize++;
  return [besti, bestj, bestsize] as const;
}

export interface SimilarOptions {
  /** Minimum average attribute similarity (0..1). */
  threshold?: number;
  /** Attributes that differ per item by nature and say nothing about its kind. */
  ignoreAttributes?: readonly string[];
}

/**
 * Elements shaped like `target` anywhere on the page: at the same depth, with the same tag,
 * parent tag and grandparent tag, and attributes at least `threshold` alike. On a list page,
 * one record's element finds the same element of every other record.
 */
export function findSimilar($: CheerioAPI, target: Element, { threshold = 0.2, ignoreAttributes = ["href", "src"] }: SimilarOptions = {}): Element[] {
  const depth = ancestorsOf(target).length;
  const chain = tagChain(target);
  const attributes = comparableAttributes(target, ignoreAttributes);
  return ($(target.tagName).toArray() as Element[]).filter(
    (el) =>
      el !== target &&
      ancestorsOf(el).length === depth &&
      tagChain(el) === chain &&
      areAlike(attributes, comparableAttributes(el, ignoreAttributes), threshold),
  );
}

/** Scrapling's attribute test: summed value similarity over the candidate's attribute count. */
function areAlike(original: Record<string, string>, candidate: Record<string, string>, threshold: number): boolean {
  const originalEntries = Object.entries(original);
  const candidateCount = Object.keys(candidate).length;
  if (originalEntries.length === 0) return candidateCount === 0;
  if (candidateCount === 0) return false;
  const score = originalEntries.reduce((sum, [key, value]) => sum + sequenceRatio(value, candidate[key] ?? ""), 0);
  return Math.round((score / candidateCount) * 100) / 100 >= threshold;
}

/** Element ancestors, nearest first (the document root is not an element). */
export function ancestorsOf(el: Element): Element[] {
  const out: Element[] = [];
  for (let node = el.parent; node && node.type === "tag"; node = node.parent) out.push(node as Element);
  return out;
}

const tagChain = (el: Element) => [el, ...ancestorsOf(el).slice(0, 2)].map((e) => e.tagName).join("<");

const comparableAttributes = (el: Element, ignore: readonly string[]) =>
  Object.fromEntries(Object.entries(el.attribs).filter(([key]) => !ignore.includes(key)));
