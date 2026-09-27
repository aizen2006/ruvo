import type { FieldSpec } from "@repo/contracts";
import { z } from "zod";
import type { FieldValue } from "../../adapters/types";
import { truncate } from "../../libs/text";
import type { ExtractorRung } from "../ladder";
import { detectArrangement } from "../parsers/remote";
import { formatSalary, parseSalary } from "../parsers/salary";
import { verifyQuote } from "../verifyQuote";

/** Text beyond this is cut (and reported) to keep calls cheap; job posts rarely need more. */
const MAX_INPUT_CHARS = 8000;

const SYSTEM_PROMPT = `You extract fields from one job posting. For each requested field return:
- value: the value as stated in the text, or null if the text does not state it
- quote: the exact span of the text you took the value from, copied character for character, or null
Never infer or guess. A value without a verbatim quote from the text will be discarded.
For "remote", answer "remote", "hybrid" or "onsite". For "salary", copy the pay range as written.`;

/**
 * The last rung: a worker-model call per text, used only for fields cheaper rungs missed.
 * Every value must come with a verbatim quote; quotes not found in the source are dropped.
 */
export const llmRung: ExtractorRung = {
  rung: "llm",
  async fill(ctx, fields, input) {
    const names = fields.map((f) => f.name);
    if (names.length === 0) return {};
    const schema = z.object({
      fields: z.array(z.object({ name: z.enum(names as [string, ...string[]]), value: z.string().nullable(), quote: z.string().nullable() })),
    });

    const text = input.text.length > MAX_INPUT_CHARS ? input.text.slice(0, MAX_INPUT_CHARS) : input.text;
    if (text.length < input.text.length) {
      ctx.emit({
        stage: "extracting",
        type: "extract.truncated",
        level: "warn",
        message: `Only the first ${MAX_INPUT_CHARS} of ${input.text.length} characters were sent for AI extraction`,
        data: { sourceUrl: input.sourceUrl },
      });
    }

    const { data } = await ctx.llm.parse({
      stage: "extract",
      role: "worker",
      schema,
      name: "field_extraction",
      system: SYSTEM_PROMPT,
      user: JSON.stringify({ fields: fields.map(({ name, description }) => ({ name, description })), text }),
      signal: ctx.signal,
      run: ctx,
    });

    const out: Record<string, FieldValue> = {};
    for (const extracted of data.fields) {
      const field = fields.find((f) => f.name === extracted.name);
      if (!field || !extracted.value || !extracted.quote) continue;
      const span = verifyQuote(extracted.quote, input.text);
      if (!span) {
        ctx.emit({
          stage: "extracting",
          type: "extract.unverified",
          level: "warn",
          message: `Discarded an AI-extracted ${field.name}: its quote was not found in the source`,
          data: { field: field.name, quote: truncate(extracted.quote, 120), sourceUrl: input.sourceUrl },
        });
        continue;
      }
      out[field.name] = {
        value: normalizeValue(field, extracted.value),
        evidence: {
          method: "LLM",
          sourceUrl: input.sourceUrl,
          pageId: input.pageId,
          snippet: truncate(input.text.slice(span.start, span.end), 300),
          locator: { kind: "textSpan", value: `${span.start}-${span.end}` },
          verified: true,
        },
      };
    }
    return out;
  },
};

/** Puts model output into the same shape the deterministic parsers produce. */
function normalizeValue(field: FieldSpec, value: string): string {
  if (field.catalogKey === "remote") return detectArrangement(value) ?? value.trim().toLowerCase();
  if (field.catalogKey === "salary") {
    const salary = parseSalary(value);
    return salary ? formatSalary(salary) : value.trim();
  }
  return value.trim();
}
