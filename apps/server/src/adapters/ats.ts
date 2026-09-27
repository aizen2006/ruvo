import { z } from "zod";
import type { SalaryPeriod } from "../extract/parsers/salary";

/** Parameters shared by all ATS job-board adapters. */
export const AtsParams = z.object({
  /** Board identifier in the ATS URL, e.g. "anthropic" in boards-api.greenhouse.io/v1/boards/anthropic. */
  slug: z.string().min(1),
  /** Display name from the registry; used when the ATS response doesn't name the company. */
  company: z.string().min(1),
});
export type AtsParams = z.infer<typeof AtsParams>;

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
