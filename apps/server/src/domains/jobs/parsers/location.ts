import { detectArrangement } from "./remote";

/** Joins an ATS primary location with secondary ones, dropping blanks and duplicates. */
export function joinLocations(locations: Array<string | null | undefined>): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const loc of locations) {
    const clean = (loc ?? "").replace(/\s+/g, " ").trim();
    if (clean && !seen.has(clean.toLowerCase())) {
      seen.add(clean.toLowerCase());
      parts.push(clean);
    }
  }
  return parts.join("; ");
}

/**
 * Coarse location key for deduplication: "remote", or the first city-like token
 * ("San Francisco, CA; New York" → "san francisco"). Deliberately lossy.
 */
export function locationBucket(location: string | null | undefined): string {
  if (!location) return "unknown";
  if (detectArrangement(location) === "remote") return "remote";
  const first = location.split(/[;|/]| or /i)[0] ?? "";
  const city = first.split(",")[0]?.trim().toLowerCase() ?? "";
  return city.replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ") || "unknown";
}
