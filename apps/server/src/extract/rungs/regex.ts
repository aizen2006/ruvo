import { fromText } from "../../adapters/fields";
import type { FieldValue } from "../../adapters/types";
import type { ExtractorRung } from "../ladder";
import { formatSalary, parseSalary } from "../parsers/salary";

/**
 * Deterministic patterns over free text. Only salary is reliable enough to read from whole
 * descriptions; arrangement words appear in too many unrelated contexts ("our remote-first culture").
 */
export const regexRung: ExtractorRung = {
  rung: "regex",
  async fill(_ctx, fields, input) {
    const out: Record<string, FieldValue> = {};
    for (const field of fields) {
      if (field.catalogKey !== "salary") continue;
      const salary = parseSalary(input.text);
      const value = salary ? fromText(formatSalary(salary), salary.raw, input.text, input) : undefined;
      if (value) out[field.name] = value;
    }
    return out;
  },
};
