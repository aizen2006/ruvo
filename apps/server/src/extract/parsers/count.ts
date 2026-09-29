const SUFFIX: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, b: 1e9, billion: 1e9 };

/**
 * The first count in a text as a plain number: "24K followers" → 24000, "1.2M" → 1200000,
 * "8,100 subscribers" → 8100. Null when the text holds no number.
 */
export function parseCount(text: string): number | null {
  const match = /(\d[\d,]*(?:\.\d+)?)\s*(k|m|b|thousand|million|billion)?\b/i.exec(text);
  if (!match) return null;
  const base = Number(match[1]!.replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  return Math.round(base * (SUFFIX[match[2]?.toLowerCase() ?? ""] ?? 1));
}
