import { createHash } from "node:crypto";

export const sha256 = (input: string) => createHash("sha256").update(input).digest("hex");

/** JSON.stringify with sorted object keys, so equal values always hash the same. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}
