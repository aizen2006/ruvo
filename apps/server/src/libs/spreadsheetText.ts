import { INVISIBLE } from "./text";

/**
 * A cell a spreadsheet could read as a formula: one starting with a tab or a carriage return, or
 * with =, +, - or @ (or their full-width forms ＝＋－＠), even after spaces or line breaks.
 */
const FORMULA = /^(?:[\t\r]|\s*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20])/;

/**
 * A value as spreadsheet cell text. Exported values come from scraped, untrusted pages, so text
 * a spreadsheet would treat as a formula is prefixed with a quote, and invisible and
 * bidirectional control characters, which can hide or reorder what a reader sees, are removed
 * first. Every other character is kept exactly as collected.
 */
export function spreadsheetText(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = (typeof value === "object" ? JSON.stringify(value) : String(value)).replace(INVISIBLE, "");
  return FORMULA.test(text) ? `'${text}` : text;
}
