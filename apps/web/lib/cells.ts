import type { DatasetContract, FieldSpec } from "@repo/contracts";

/** A record value as table text; missing values show as a dash. */
export const cellText = (value: unknown) => (value === null || value === undefined || value === "" ? "—" : String(value));

/** Long text stays out of tables (it is in the receipt); the link gets its own column. */
const OUT_OF_TABLE = new Set(["description", "url"]);

export const tableColumns = (contract: DatasetContract): FieldSpec[] => contract.fields.filter((f) => !OUT_OF_TABLE.has(f.catalogKey));

export const linkField = (contract: DatasetContract) => contract.fields.find((f) => f.catalogKey === "url" || f.type === "url")?.name;
