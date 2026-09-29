import { spreadsheetText } from "./spreadsheetText";

/** RFC 4180 CSV, with formula-like values neutralised (see spreadsheetText). */
export function toCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const lines = [headers.map(cell).join(","), ...rows.map((row) => headers.map((h) => cell(row[h])).join(","))];
  return `${lines.join("\r\n")}\r\n`;
}

function cell(value: unknown): string {
  const text = spreadsheetText(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
