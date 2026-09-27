import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { normalizeWhitespace } from "../libs/text";
import { elementSignature } from "./selectors";

const SKIP = new Set(["script", "style", "noscript", "template", "svg", "iframe", "head", "link", "meta"]);
const KEEP_ATTRS = ["id", "class", "href", "role", "data-ui", "data-testid", "data-test", "data-qa", "itemprop", "aria-label"];

/**
 * An indented outline of the page's DOM for LLM selector discovery: tags with their useful
 * attributes and a text sample, repeated siblings collapsed after the first two, and a
 * character cap. It shows structure without sending raw HTML.
 */
export function pageSkeleton(html: string, maxChars = 12_000): string {
  const $ = cheerio.load(html);
  const lines: string[] = [];
  let size = 0;

  const describe = (el: Element) => {
    const attrs = KEEP_ATTRS.map((name) => {
      const value = el.attribs[name];
      if (!value) return "";
      return name === "href" ? ` href="${value.slice(0, 60)}"` : ` ${name}="${value.slice(0, 80)}"`;
    }).join("");
    const ownText = normalizeWhitespace(
      $(el)
        .contents()
        .filter((_, n) => n.type === "text")
        .text(),
    );
    return `<${el.tagName}${attrs}>${ownText ? ` ${ownText.slice(0, 80)}` : ""}`;
  };

  const walk = (nodes: AnyNode[], depth: number) => {
    const elements = nodes.filter((n): n is Element => n.type === "tag" && !SKIP.has((n as Element).tagName));
    const seen = new Map<string, number>();
    for (const el of elements) {
      if (size > maxChars) return;
      const sig = elementSignature(el);
      const count = (seen.get(sig) ?? 0) + 1;
      seen.set(sig, count);
      if (count === 3) {
        const total = elements.filter((e) => elementSignature(e) === sig).length;
        push(depth, `… ${total - 2} more like the above`);
      }
      if (count >= 3) continue;
      push(depth, describe(el));
      walk(el.children, depth + 1);
    }
  };

  const push = (depth: number, line: string) => {
    const indented = `${"  ".repeat(Math.min(depth, 12))}${line}`;
    lines.push(indented);
    size += indented.length + 1;
  };

  walk($("body").get(0)?.children ?? [], 0);
  return size > maxChars ? `${lines.join("\n")}\n… (truncated)` : lines.join("\n");
}
