import { z } from "zod";
import type { SalaryPeriod } from "../extract/parsers/salary";

/** Parameters shared by all ATS job-board adapters. */
export const AtsParams = z.object({
  /** Board identifier in the ATS URL, e.g. "anthropic" in boards-api.greenhouse.io/v1/boards/anthropic. */
  slug: z.string().min(1),
  /** Display name from the registry; used when the ATS response doesn't name the company. */
  company: z.string().min(1),
  /** Registry tags (ai_lab, ai_infra, …) carried onto items for "good company" signals. */
  tags: z.array(z.string()).default([]),
});
export type AtsParams = z.infer<typeof AtsParams>;

export type Ats = "greenhouse" | "ashby" | "lever" | "workable";
export const ATS_LIST: readonly Ats[] = ["greenhouse", "ashby", "lever", "workable"];

const slugPart = (slug: string) => encodeURIComponent(slug);

/** Public job-list endpoints for each ATS; shared by the adapters and board probing. */
export const ATS_BOARD_URL: Record<Ats, (slug: string) => string> = {
  greenhouse: (slug) => `https://boards-api.greenhouse.io/v1/boards/${slugPart(slug)}/jobs?content=true`,
  ashby: (slug) => `https://api.ashbyhq.com/posting-api/job-board/${slugPart(slug)}?includeCompensation=true`,
  lever: (slug) => `https://api.lever.co/v0/postings/${slugPart(slug)}?mode=json`,
  workable: (slug) => `https://apply.workable.com/api/v1/widget/accounts/${slugPart(slug)}`,
};

/** Number of postings in a board response, whatever its shape. */
export function countPostings(data: unknown): number {
  if (Array.isArray(data)) return data.length;
  const jobs = (data as { jobs?: unknown[] } | null)?.jobs;
  return Array.isArray(jobs) ? jobs.length : 0;
}

/** ATS JSON list responses can be large (hundreds of postings with full descriptions). */
export const ATS_MAX_BYTES = 40 * 1024 * 1024;

/** Maps ATS pay intervals ("1 YEAR", "per-hour-wage", …) onto salary periods. */
export function periodFromInterval(interval: string | null | undefined): SalaryPeriod {
  const v = (interval ?? "").toLowerCase();
  if (v.includes("hour")) return "hour";
  if (v.includes("month")) return "month";
  return "year";
}

/** "FullTime" / "full_time" / "Full-time" → "Full-time". */
export function humanizeEmploymentType(value: string | null | undefined): string | null {
  if (!value) return null;
  const words = value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1).replace(/ /g, "-") : null;
}
