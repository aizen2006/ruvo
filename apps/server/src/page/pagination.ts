import * as cheerio from "cheerio";
import { singleLine } from "../libs/text";
import { absoluteUrl, canonicalUrl } from "../libs/url";

const PAGINATION = "nav, .pagination, .pager, [role=navigation]";
/** "Next", "Next page", "Older posts", "»", "Next →". */
const NEXT_LABEL = /^(next|older)\b|^[»›→]$|[»›→]$/i;

/**
 * The address of the page after this one in a paginated list, or null. Tried in order:
 * a rel=next link, a "next" link in the page's pagination, and the pagination link numbered
 * one past the current page.
 */
export function nextPageUrl(html: string, url: string): string | null {
  const $ = cheerio.load(html);
  const resolve = (href: string | undefined) => {
    const next = href ? absoluteUrl(href, url) : null;
    return next && canonicalUrl(next) !== canonicalUrl(url) ? next : null;
  };
  const links = $(PAGINATION).find("a[href]").toArray();
  const label = (el: (typeof links)[number]) => singleLine($(el).text()) || $(el).attr("aria-label") || "";

  const relNext = resolve($('link[rel~="next"], a[rel~="next"]').first().attr("href"));
  if (relNext) return relNext;

  const nextLink = links.find((el) => NEXT_LABEL.test(label(el)));
  if (nextLink) return resolve(nextLink.attribs.href);

  const current = Number(singleLine($(PAGINATION).find('[aria-current="page"], .current, .active').first().text())) || 1;
  const numbered = links.find((el) => label(el) === String(current + 1));
  return numbered ? resolve(numbered.attribs.href) : null;
}
