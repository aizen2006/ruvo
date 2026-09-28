import * as cheerio from "cheerio";
import { normalizeWhitespace } from "../libs/text";

/**
 * The organization a page belongs to, e.g. "Northwind Labs" on its own careers page, with
 * the markup it was read from (kept as evidence). Tried in order of reliability: declared
 * site names, then the main heading, then the title before its separator ("Acme | Careers").
 */
export function siteOwner(html: string): { name: string; basis: string } | null {
  const $ = cheerio.load(html);
  const meta = (selector: string) => normalizeWhitespace($(selector).first().attr("content") ?? "");

  const declared = meta('meta[property="og:site_name"]') || meta('meta[name="application-name"]');
  if (plausible(declared)) return { name: declared, basis: `<meta> site name: ${declared}` };

  const h1 = normalizeWhitespace($("h1").first().text());
  if (plausible(h1)) return { name: h1, basis: `<h1>${h1}</h1>` };

  const title = normalizeWhitespace($("title").first().text());
  const lead = title.split(/\s+[|\-–—:]\s+/)[0]?.trim() ?? "";
  if (plausible(lead)) return { name: lead, basis: `<title>${title}</title>` };
  return null;
}

/** A short proper name, not a sentence or a generic heading. */
const GENERIC = /^(careers?|jobs?|open (roles|positions)|join us|work with us|home)$/i;
const plausible = (s: string) => s.length >= 2 && s.length <= 60 && s.split(/\s+/).length <= 6 && !GENERIC.test(s);
