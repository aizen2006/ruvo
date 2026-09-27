import type { Criterion, DatasetContract, Signal } from "@repo/contracts";
import type { FieldValue } from "../../adapters/types";
import { fieldText, type Candidate } from "../candidate";
import { itemKeyFor } from "../contractFields";
import { compileKeywords } from "../keywords";
import type { StepFn } from "./types";

/**
 * Evaluates the contract's criteria against each candidate with deterministic rules.
 * - hard criteria that fail become reject reasons
 * - soft criteria earn their weight; matchScore is the share of soft weight earned (0..1)
 * - semantic criteria need the decision layer and stay undecided (passed: null) here
 * If the contract asks for a match_reason column, it is derived from the passing signals.
 */
export const match: StepFn<"match"> = async (ctx, _branch, step, input) => {
  const criteria = ctx.contract.criteria.filter((c) => step.criteria.includes(c.id));
  const evaluators = criteria.map((c) => ({ criterion: c, evaluate: compileCriterion(ctx.contract, c) }));
  const softTotal = criteria.filter((c) => c.strength === "soft").reduce((sum, c) => sum + c.weight, 0);
  const reasonField = ctx.contract.fields.find((f) => f.catalogKey === "match_reason");

  return input.map((candidate) => {
    const signals: Signal[] = evaluators.map(({ criterion, evaluate }) => ({
      criterionId: criterion.id,
      label: criterion.label,
      passed: evaluate(candidate),
      strength: criterion.strength,
      decidedBy: "RULES",
    }));
    const rejectReasons = [
      ...candidate.rejectReasons,
      ...signals.filter((s) => s.strength === "hard" && s.passed === false).map((s) => `${s.label}: not met`),
    ];
    const earned = criteria
      .filter((c, i) => c.strength === "soft" && signals[i]!.passed)
      .reduce((sum, c) => sum + c.weight, 0);

    const next: Candidate = {
      ...candidate,
      signals: [...candidate.signals, ...signals],
      rejectReasons,
      matchScore: softTotal > 0 ? earned / softTotal : 1,
    };
    return reasonField ? withMatchReason(next, reasonField.name) : next;
  });
};

/** "Matches: Backend / AI engineering role; Remote. Not confirmed: AI lab company." */
export function describeMatch(signals: Signal[]): string {
  const passed = signals.filter((s) => s.passed === true).map((s) => s.label);
  const missed = signals.filter((s) => s.strength === "soft" && s.passed === false).map((s) => s.label);
  const parts = [passed.length ? `Matches: ${passed.join("; ")}.` : "No criteria confirmed."];
  if (missed.length) parts.push(`Not confirmed: ${missed.join("; ")}.`);
  return parts.join(" ");
}

function withMatchReason(candidate: Candidate, fieldName: string): Candidate {
  const reason = describeMatch(candidate.signals);
  const field: FieldValue = {
    value: reason,
    evidence: {
      method: "DERIVED",
      sourceUrl: fieldText(candidate, "url"),
      pageId: null,
      snippet: reason,
      locator: { kind: "derived", value: "match signals" },
      verified: true,
    },
  };
  return { ...candidate, item: { ...candidate.item, fields: { ...candidate.item.fields, [fieldName]: field } } };
}

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
