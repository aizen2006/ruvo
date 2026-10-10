/**
 * Case-insensitive keyword matching anchored at word starts, so "infra" matches
 * "Infrastructure" but "api" does not match "capital".
 */
export function compileKeywords(keywords: string[]): RegExp | null {
  const parts = keywords.map((k) => k.trim()).filter(Boolean).map(escapeRegex);
  return parts.length ? new RegExp(`(?:^|[^a-z0-9])(?:${parts.join("|")})`, "i") : null;
}

/** Returns the first keyword found in `text`, or null. */
export function firstKeywordMatch(pattern: RegExp | null, text: string): string | null {
  const match = pattern?.exec(text);
  return match ? match[0].replace(/^[^a-z0-9]/i, "") : null;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
