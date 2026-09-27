import type { Criterion, DatasetContract, Signal } from "@repo/contracts";
import { fieldText, type Candidate } from "../candidate";
import { itemKeyFor } from "../contractFields";
import { compileKeywords } from "../keywords";
import type { StepFn } from "./types";

/**
 * Evaluates the contract's criteria against each candidate with deterministic rules.
 * Hard criteria that fail become reject reasons; soft criteria add their weight to the score.
 * Semantic criteria need the decision layer and are left undecided (passed: null) here.
 */
export const match: StepFn<"match"> = async (ctx, _branch, step, input) => {
  const criteria = ctx.contract.criteria.filter((c) => step.criteria.includes(c.id));
  const evaluators = criteria.map((c) => ({ criterion: c, evaluate: compileCriterion(ctx.contract, c) }));

  return input.map((candidate) => {
    const signals: Signal[] = [];
    const rejectReasons = [...candidate.rejectReasons];
    let score = candidate.matchScore;

    for (const { criterion, evaluate } of evaluators) {
      const passed = evaluate(candidate);
      signals.push({ criterionId: criterion.id, label: criterion.label, passed, strength: criterion.strength, decidedBy: "RULES" });
      if (criterion.strength === "hard" && passed === false) rejectReasons.push(`${criterion.label}: not met`);
      if (criterion.strength === "soft" && passed) score += criterion.weight;
    }
    return { ...candidate, signals: [...candidate.signals, ...signals], rejectReasons, matchScore: score };
  });
};

type Evaluate = (candidate: Candidate) => boolean | null;

/** Builds a rule for one criterion; returns null (undecided) when the input is missing. */
export function compileCriterion(contract: DatasetContract, criterion: Criterion): Evaluate {
  const text = (c: Candidate) => criterion.fields.map((f) => fieldText(c, itemKeyFor(contract, f))).join(" \n ");

  switch (criterion.kind) {
    case "keyword_any": {
      const pattern = compileKeywords(criterion.values);
      return (c) => (pattern ? pattern.test(text(c)) : null);
    }
    case "keyword_none": {
      const pattern = compileKeywords(criterion.values);
      return (c) => (pattern ? !pattern.test(text(c)) : null);
    }
    case "equals": {
      const allowed = new Set(criterion.values.map((v) => v.toLowerCase()));
      return (c) => {
        const value = text(c).trim().toLowerCase();
        return value ? allowed.has(value) : null;
      };
    }
    case "regex": {
      const pattern = safeRegex(criterion.values[0]);
      return (c) => (pattern ? pattern.test(text(c)) : null);
    }
    case "company_tag": {
      const wanted = new Set(criterion.values);
      return (c) => {
        const tags = (c.item.meta.companyTags as string[] | undefined) ?? [];
        return tags.some((t) => wanted.has(t));
      };
    }
    case "semantic":
      return () => null;
  }
}

function safeRegex(source: string | undefined): RegExp | null {
  if (!source) return null;
  try {
    return new RegExp(source, "i");
  } catch {
    return null;
  }
}
