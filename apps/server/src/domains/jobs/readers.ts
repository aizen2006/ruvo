import { fromText } from "../../adapters/fields";
import type { FieldValue } from "../../core/items";
import type { ExtractorRung } from "../../extract/ladder";
import type { FieldParser, JsonLdReader } from "../types";
import { joinLocations, locationBucket } from "./parsers/location";
import { detectArrangement } from "./parsers/remote";
import { formatSalary, parseSalary, type SalaryPeriod } from "./parsers/salary";

/** How the jobs domain reads its values, wherever they come from: list pages, the LLM, JSON-LD or free text. */

const arrangement = (raw: string) => detectArrangement(raw) ?? raw.trim().toLowerCase();
const LEGAL_SUFFIX = /\b(inc|incorporated|llc|ltd|limited|gmbh|corp|corporation|co|plc|sa|ag|bv)\b\.?/g;

/** Job fields RUVO keeps in one form, so values from every source compare and dedupe alike. */
export const jobParsers: Record<string, FieldParser> = {
  // "fully remote" states "remote", whatever words a page or the model used.
  remote: {
    normalize: arrangement,
    supports: (value, quote) => {
      const stated = detectArrangement(quote);
      return stated !== null && stated === arrangement(value);
    },
  },
  // "$250k-$300k" states "250,000–300,000": pay is compared as parsed ranges.
  salary: {
    normalize: (raw) => {
      const salary = parseSalary(raw);
      return salary ? formatSalary(salary) : raw.trim();
    },
    supports: (value, quote) => {
      const [fromValue, fromQuote] = [parseSalary(value), parseSalary(quote)];
      return fromValue !== null && fromQuote !== null && fromValue.min === fromQuote.min && fromValue.max === fromQuote.max;
    },
  },
  location: { dedupeKey: locationBucket },
  company: { dedupeKey: (value) => value.toLowerCase().replace(LEGAL_SUFFIX, "") },
};

type Posting = Record<string, unknown>;
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const wrap = (value: string | null, path: string) => (value ? { value, path } : null);

/** schema.org JobPosting properties that answer each catalog field. */
const POSTING_FIELDS: Record<string, (p: Posting) => { value: string; path: string } | null> = {
  title: (p) => wrap(text(p.title), "title"),
  company: (p) => wrap(text((p.hiringOrganization as Posting | undefined)?.name), "hiringOrganization.name"),
  location: (p) => {
    const places = ([] as unknown[]).concat(p.jobLocation ?? []) as Posting[];
    const names = places.map((place) => {
      const address = (place?.address ?? {}) as Posting;
      return [address.addressLocality, address.addressRegion, address.addressCountry].map(text).filter(Boolean).join(", ");
    });
    return wrap(joinLocations(names) || null, "jobLocation.address");
  },
  remote: (p) => (p.jobLocationType === "TELECOMMUTE" ? { value: "remote", path: "jobLocationType" } : null),
  employment_type: (p) => wrap(text(([] as unknown[]).concat(p.employmentType ?? [])[0]), "employmentType"),
  posted_at: (p) => wrap(text(p.datePosted), "datePosted"),
  salary: (p) => {
    const salary = p.baseSalary as Posting | undefined;
    const value = (salary?.value ?? {}) as Posting;
    const min = Number(value.minValue ?? value.value);
    const max = Number(value.maxValue ?? value.value);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0) return null;
    const unit = String(value.unitText ?? "YEAR").toUpperCase();
    const period: SalaryPeriod = unit.startsWith("HOUR") ? "hour" : unit.startsWith("MONTH") ? "month" : "year";
    return { value: formatSalary({ min, max, currency: text(salary?.currency), period }), path: "baseSalary" };
  },
};

/** The JobPosting a job page publishes for search engines; a job request reads no other kind. */
export const jobPostingReader: JsonLdReader = {
  matches: (node) => ([] as unknown[]).concat(node["@type"]).includes("JobPosting"),
  read: (node, field) => (Object.hasOwn(POSTING_FIELDS, field.catalogKey) ? POSTING_FIELDS[field.catalogKey]!(node) : null),
};

/**
 * Pay ranges in free text. Only salary is reliable enough to read from whole descriptions by
 * pattern; arrangement words appear in too many unrelated contexts ("our remote-first culture").
 */
export const salaryRung: ExtractorRung = {
  rung: "regex",
  async fill(_ctx, fields, input) {
    const out: Record<string, FieldValue> = {};
    for (const field of fields) {
      if (field.catalogKey !== "salary") continue;
      const salary = parseSalary(input.text);
      const value = salary ? fromText(formatSalary(salary), salary.raw, input.text, input) : undefined;
      if (value) out[field.name] = value;
    }
    return out;
  },
};
