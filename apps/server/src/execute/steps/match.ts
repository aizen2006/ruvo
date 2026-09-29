import type { Criterion, DatasetContract, Signal } from "@repo/contracts";
import type { FieldValue } from "../../adapters/types";
import { thresholdsFor } from "../../decide/calibration";
import { noulBand, type DecisionRequest } from "../../decide/decider";
import { truncate } from "../../libs/text";
import { fieldText, type Candidate } from "../candidate";
import { itemKeyFor } from "../contractFields";
import { compileKeywords } from "../keywords";
import type { StepFn } from "./types";

/**
 * Evaluates the contract's criteria against each candidate.
 * - rule-based criteria (keywords, equals, regex, company tags) are decided in code
 * - semantic criteria go to the decision layer (Jev, then the LLM judge), but only for
 *   candidates that have not already failed a hard rule; undecided ones stay null
 * - hard criteria that fail become reject reasons
 * - soft criteria earn their weight; matchScore is the share of soft weight earned (0..1)
 * If the contract asks for a match_reason column, it is derived from the signals.
 */
export const match: StepFn<"match"> = async (ctx, _branch, step, input) => {
  const criteria = ctx.contract.criteria.filter((c) => step.criteria.includes(c.id));
  const evaluators = criteria.map((c) => ({ criterion: c, evaluate: compileCriterion(ctx.contract, c) }));

  const evaluated = input.map((candidate) => ({
    candidate,
    signals: evaluators.map(({ criterion, evaluate }): Signal => ({
      criterionId: criterion.id,
      label: criterion.label,
      passed: evaluate(candidate),
      strength: criterion.strength,
      decidedBy: "RULES",
    })),
  }));

  await decideSemanticCriteria(ctx, criteria, evaluated);
  return evaluated.map(({ candidate, signals }) => finalize(ctx.contract, criteria, candidate, signals));
};

type Evaluated = { candidate: Candidate; signals: Signal[] };

async function decideSemanticCriteria(ctx: Parameters<StepFn<"match">>[0], criteria: Criterion[], evaluated: Evaluated[]) {
  const failedHardRule = (e: Evaluated) => e.signals.some((s) => s.strength === "hard" && s.passed === false);
  const jobs = criteria.flatMap((criterion, index) =>
    criterion.kind !== "semantic"
      ? []
      : evaluated.filter((e) => !failedHardRule(e)).map((e) => ({ e, index, request: semanticRequest(ctx.contract, criterion, e.candidate) })),
  );
  if (jobs.length === 0) return;

  const results = await ctx.decider.decideMany(ctx, jobs.map((j) => j.request));
  jobs.forEach(({ e, index }, i) => {
    const decision = results[i]!;
    e.signals[index] = {
      ...e.signals[index]!,
      passed: decision.label === "unknown" ? null : decision.label === "yes",
      decidedBy: decision.decidedBy,
    };
  });
}

/** The state the decision model sees: the facts that matter, without noise. */
function semanticRequest(contract: DatasetContract, criterion: Criterion, candidate: Candidate): DecisionRequest<"yes" | "no" | "unknown"> {
  const description = truncate(candidate.item.text?.plain ?? fieldText(candidate, "description"), 800);
  const state =
    contract.entity === "job_posting"
      ? {
          title: fieldText(candidate, "title"),
          team: fieldText(candidate, "department") || String(candidate.item.meta.team ?? ""),
          location: fieldText(candidate, "location"),
          company: fieldText(candidate, "company"),
          description,
        }
      : // Any other record: what kind of thing it is, and its own columns by name.
        {
          kind: contract.entityDescription,
          ...Object.fromEntries(contract.fields.map((f) => [f.name, truncate(fieldText(candidate, itemKeyFor(contract, f.name)), 300)])),
          description,
        };
  return {
    task: "CRITERION",
    subject: fieldText(candidate, "title") || candidate.key,
    state,
    question: { type: "noul", instructions: criterion.values[0] ?? criterion.label },
    labels: ["yes", "no", "unknown"],
    band: noulBand(thresholdsFor("CRITERION").yes, thresholdsFor("CRITERION").no),
    defaultLabel: "unknown",
  };
}

function finalize(contract: DatasetContract, criteria: Criterion[], candidate: Candidate, signals: Signal[]): Candidate {
  const softTotal = criteria.filter((c) => c.strength === "soft").reduce((sum, c) => sum + c.weight, 0);
  const earned = criteria.filter((c, i) => c.strength === "soft" && signals[i]!.passed).reduce((sum, c) => sum + c.weight, 0);
  const next: Candidate = {
    ...candidate,
    signals: [...candidate.signals, ...signals],
    rejectReasons: [...candidate.rejectReasons, ...signals.filter((s) => s.strength === "hard" && s.passed === false).map((s) => `${s.label}: not met`)],
    matchScore: softTotal > 0 ? earned / softTotal : 1,
  };
  const reasonField = contract.fields.find((f) => f.catalogKey === "match_reason");
  return reasonField ? withMatchReason(next, reasonField.name) : next;
}

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
        // Companies outside the registry (e.g. Hacker News posters) have no known tags:
        // that is "unknown", not "fails", so they are not rejected for it.
        const tags = (c.item.meta.companyTags as string[] | undefined) ?? [];
        return tags.length === 0 ? null : tags.some((t) => wanted.has(t));
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
