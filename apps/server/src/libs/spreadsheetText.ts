import { INVISIBLE } from "./text";

/**
 * A value as spreadsheet cell text. Exported values come from scraped, untrusted pages, so text
 * a spreadsheet would treat as a formula (=, +, -, @) is prefixed with a quote, and invisible and
 * bidirectional control characters, which can hide or reorder what a reader sees, are removed
 * first. Every other character is kept exactly as collected.
 */
export function spreadsheetText(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = (typeof value === "object" ? JSON.stringify(value) : String(value)).replace(INVISIBLE, "");
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}
