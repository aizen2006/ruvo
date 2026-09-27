import type { FieldSpec } from "@repo/contracts";
import * as cheerio from "cheerio";
import type { FieldValue } from "../../adapters/types";
import { truncate } from "../../libs/text";
import { extractJsonLd, jsonLdOfType } from "../../page/structured";
import type { ExtractorRung } from "../ladder";
import { joinLocations } from "../parsers/location";
import { formatSalary, type SalaryPeriod } from "../parsers/salary";

type Posting = Record<string, unknown>;
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** schema.org JobPosting properties that answer each catalog field. */
const READERS: Partial<Record<FieldSpec["catalogKey"], (p: Posting) => { value: string; path: string } | null>> = {
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

const wrap = (value: string | null, path: string) => (value ? { value, path } : null);

/**
 * Reads schema.org JobPosting JSON-LD, which many job pages publish for search engines.
 * Structured and exact, so it outranks DOM, regex and LLM extraction.
 */
export const jsonLdRung: ExtractorRung = {
  rung: "json_ld",
  async fill(_ctx, fields, input) {
    if (!input.html) return {};
    const [posting] = jsonLdOfType(extractJsonLd(cheerio.load(input.html)), "JobPosting");
    if (!posting) return {};

    const out: Record<string, FieldValue> = {};
    for (const field of fields) {
      const read = READERS[field.catalogKey]?.(posting);
      if (!read) continue;
      out[field.name] = {
        value: read.value,
        evidence: {
          method: "JSON_LD",
          sourceUrl: input.sourceUrl,
          pageId: input.pageId,
          snippet: truncate(read.value, 300),
          locator: { kind: "jsonLd", value: `JobPosting.${read.path}` },
          verified: true,
        },
      };
    }
    return out;
  },
};
