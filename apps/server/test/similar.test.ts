import { describe, expect, test } from "bun:test";
import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { findSimilar, sequenceRatio } from "../src/page/similar";

describe("sequenceRatio", () => {
  // Expected values from Python 3: difflib.SequenceMatcher(None, a, b).ratio()
  test.each([
    ["abcd", "bcde", 0.75],
    [" abcd", "abcd abcd", 0.7142857142857143],
    ["private Thread currentThread;", "private volatile Thread currentThread;", 0.8656716417910447],
    ["Senior Backend Engineer", "Backend Engineer, Senior", 0.6808510638297872],
    ["tide", "diet", 0.25],
    ["", "", 1],
    ["abc", "", 0],
    ["héllo wörld 👋", "hello world 👋", 0.8461538461538461],
  ])("%p vs %p", (a, b, expected) => {
    expect(sequenceRatio(a, b)).toBeCloseTo(expected, 12);
  });

  test("applies difflib's autojunk heuristic to sequences of 200+ items", () => {
    expect(sequenceRatio("a".repeat(150) + "b".repeat(100), "ab".repeat(125))).toBeCloseTo(0.004, 12);
    expect(sequenceRatio("The quick brown fox jumps over the lazy dog. ".repeat(6), "A quick brown dog jumps over the lazy fox! ".repeat(6))).toBe(0);
  });

  test("compares arrays item by item", () => {
    expect(sequenceRatio(["html", "body", "div", "ul", "li"], ["html", "body", "main", "div", "ul", "li"])).toBeCloseTo(0.9090909090909091, 12);
  });
});

describe("findSimilar", () => {
  const $ = cheerio.load(`<body>
    <ul class="jobs">
      <li class="card" data-id="a1"><a href="/a1">One</a></li>
      <li class="card" data-id="b2"><a href="/b2">Two</a></li>
      <li class="card featured" data-id="c3"><a href="/c3">Three</a></li>
    </ul>
    <ol><li class="card"><a href="/x">Elsewhere</a></li></ol>
    <ul class="nav"><li><a href="/home">Home</a></li></ul>
    <div><ul class="jobs"><li class="card" data-id="d4"><a href="/d4">Deeper</a></li></ul></div>
  </body>`);
  const first = $("li[data-id=a1]").get(0) as Element;

  test("finds same-shaped elements, ignoring per-item links", () => {
    const texts = findSimilar($, first).map((el) => $(el).text());
    expect(texts).toEqual(["Two", "Three"]);
  });

  test("links compare by position and shape, not by href", () => {
    expect(findSimilar($, $("a[href='/a1']").get(0) as Element).map((el) => $(el).text())).toEqual(["Two", "Three", "Home"]);
  });

  test("a bare element only matches bare elements", () => {
    expect(findSimilar($, $("ul.nav li").get(0) as Element).map((el) => $(el).text())).toEqual([]);
  });
});
