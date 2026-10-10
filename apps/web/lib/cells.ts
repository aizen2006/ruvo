import type { DatasetContract, FieldSpec } from "@repo/contracts";

/** A record value as table text; missing values show as a dash. */
export const cellText = (value: unknown) => (value === null || value === undefined || value === "" ? "—" : String(value));

/** Long text stays out of tables (it is in the receipt); the link gets its own column. */
const OUT_OF_TABLE = new Set(["description", "url"]);

export const tableColumns = (contract: DatasetContract): FieldSpec[] => contract.fields.filter((f) => !OUT_OF_TABLE.has(f.catalogKey));

export const linkField = (contract: DatasetContract) => contract.fields.find((f) => f.catalogKey === "url" || f.type === "url")?.name;

/** A value to link to, only if it is an http(s) address: scraped file:, ms-msdt: or search-ms: values never become links. */
export function safeHref(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}
