/**
 * A value as spreadsheet cell text. Exported values come from scraped, untrusted pages, so text
 * a spreadsheet would treat as a formula (=, +, -, @) is prefixed with a quote.
 */
export function spreadsheetText(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}
