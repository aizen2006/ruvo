import type { DatasetContract } from "@repo/contracts";

/**
 * Items are keyed by catalog key ("title"); contracts may name columns differently
 * ("role" with catalogKey "title"). This maps a contract field name to the item key.
 */
export function itemKeyFor(contract: DatasetContract, fieldName: string): string {
  const field = contract.fields.find((f) => f.name === fieldName);
  return field && field.catalogKey !== "custom" ? field.catalogKey : fieldName;
}
