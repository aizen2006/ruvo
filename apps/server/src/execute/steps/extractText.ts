import type { FieldValue } from "../../adapters/types";
import { runLadder, type ExtractorRung } from "../../extract/ladder";
import { llmRung } from "../../extract/rungs/llm";
import { regexRung } from "../../extract/rungs/regex";
import { LlmError } from "../../llm/client";
import { mapLimit } from "../../libs/limit";
import type { Candidate } from "../candidate";
import { itemKeyFor } from "../contractFields";
import type { StepFn } from "./types";

const LLM_CONCURRENCY = 6;

/**
 * Fills contract fields that a text source's parser could not, using the extraction ladder.
 * Regex runs for every post. The LLM runs only for posts still missing a required field
 * (those come first), at most `llmBudget` times, and never beyond the run's LLM budget.
 */
export const extractText: StepFn<"extract_text"> = async (ctx, branch, step, input) => {
  const fields = ctx.contract.fields.filter((f) => f.catalogKey !== "match_reason");
  const has = (c: Candidate, name: string) => Boolean(c.item.fields[itemKeyFor(ctx.contract, name)]);
  const missingFor = (c: Candidate) => fields.filter((f) => !has(c, f.name));
  const lacksRequired = (c: Candidate) => fields.some((f) => f.required && !has(c, f.name));

  const needsWork = input
    .filter((c) => c.item.text && missingFor(c).length > 0)
    .sort((a, b) => Number(lacksRequired(b)) - Number(lacksRequired(a)));

  let allowance = step.llmFallback ? step.llmBudget : 0;
  let budgetSpent = false;
  // The allowance is only consumed when the LLM rung is actually reached.
  const gatedLlm: ExtractorRung = {
    rung: "llm",
    fill: (c, missing, text) => {
      if (allowance <= 0 || budgetSpent) return Promise.resolve({});
      allowance--;
      return llmRung.fill(c, missing, text);
    },
  };

  let extracted = 0;
  const results = await mapLimit(needsWork, LLM_CONCURRENCY, async (candidate) => {
    const rungs = lacksRequired(candidate) ? [regexRung, gatedLlm] : [regexRung];
    try {
      const filled = await runLadder(ctx, { ...candidate.item.text!, text: candidate.item.text!.plain }, missingFor(candidate), rungs);
      if (Object.keys(filled).length) extracted++;
      return { key: candidate.key, filled };
    } catch (err) {
      if (!(err instanceof LlmError)) throw err;
      if (err.kind === "budget_exhausted") budgetSpent = true;
      return { key: candidate.key, filled: {} as Record<string, FieldValue> };
    }
  });

  const byKey = new Map(results.map((r) => [r.key, r.filled]));
  ctx.emit({
    stage: "extracting",
    type: "extract.completed",
    sourceId: branch.id,
    message: `${branch.label}: filled fields for ${extracted} of ${needsWork.length} posts from their text${budgetSpent ? " (LLM budget reached)" : ""}`,
    data: { candidates: needsWork.length, extracted, budgetSpent },
  });

  return input.map((c) => {
    const filled = byKey.get(c.key);
    if (!filled || Object.keys(filled).length === 0) return c;
    // Ladder results are keyed by contract field name; items are keyed by catalog key.
    const mapped = Object.fromEntries(Object.entries(filled).map(([name, value]) => [itemKeyFor(ctx.contract, name), value]));
    return { ...c, item: { ...c.item, fields: { ...c.item.fields, ...mapped } } };
  });
};
