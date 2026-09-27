import type { FieldSpec, Rung } from "@repo/contracts";
import type { FieldValue } from "../adapters/types";
import type { RunContext } from "../runs/runContext";

/** What a rung can read: the source text (and HTML, for page-based rungs) and where it came from. */
export interface LadderInput {
  text: string;
  html?: string;
  sourceUrl: string;
  pageId: string | null;
}

/** One extraction method. It returns only the fields it could fill (and verify). */
export interface ExtractorRung {
  rung: Rung;
  fill(ctx: RunContext, fields: FieldSpec[], input: LadderInput): Promise<Record<string, FieldValue>>;
}

/**
 * Tries rungs in order (cheapest and most reliable first). Each rung only sees the fields
 * still missing, so expensive rungs like the LLM run only when cheaper ones came up short.
 */
export async function runLadder(
  ctx: RunContext,
  input: LadderInput,
  fields: FieldSpec[],
  rungs: ExtractorRung[],
): Promise<Record<string, FieldValue>> {
  const filled: Record<string, FieldValue> = {};
  for (const rung of rungs) {
    const missing = fields.filter((f) => !filled[f.name]);
    if (missing.length === 0) break;
    Object.assign(filled, await rung.fill(ctx, missing, input));
  }
  return filled;
}
