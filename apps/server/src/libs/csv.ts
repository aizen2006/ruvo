/**
 * RFC 4180 CSV. Values that a spreadsheet would treat as a formula (=, +, -, @) are
 * prefixed with a quote, since exported values come from scraped, untrusted pages.
 */
export function toCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const lines = [headers.map(cell).join(","), ...rows.map((row) => headers.map((h) => cell(row[h])).join(","))];
  return `${lines.join("\r\n")}\r\n`;
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
