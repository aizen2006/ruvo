import { fieldConfidence } from "../../extract/confidence";
import { canonicalUrl } from "../../libs/url";
import type { Candidate } from "../candidate";
import { itemKeyFor } from "../contractFields";
import type { StepFn } from "./types";

/**
 * Assigns each candidate a status and a confidence:
 * - invalid: a hard criterion failed or a link column holds anything but an http(s) URL
 * - incomplete: a required field is missing, or its value could not be verified
 * - valid: otherwise
 * Confidence is the weakest required field's confidence (a record is only as
 * trustworthy as its least certain essential value), capped by `maxConfidence`.
 */
export const validate: StepFn<"validate"> = async (ctx, _branch, step, input) =>
  input.map((candidate) => {
    const reasons = [...candidate.rejectReasons];
    const requiredFields = step.required.map((name) => ({ name, field: candidate.item.fields[itemKeyFor(ctx.contract, name)] }));
    const present = requiredFields.filter(({ field }) => hasVerifiedValue(field));
    const missing = requiredFields.filter((r) => !present.includes(r)).map((r) => r.name);

    // Link columns hold only http(s) addresses: a row with a file: or ms-msdt: value is set aside, out of the list and its export.
    for (const field of ctx.contract.fields.filter((f) => f.type === "url" || f.catalogKey === "url")) {
      const value = candidate.item.fields[itemKeyFor(ctx.contract, field.name)]?.value;
      if (typeof value === "string" && value && !canonicalUrl(value)) reasons.push(`Not a valid http(s) link: ${field.name}`);
    }

    const status = reasons.length ? "invalid" : missing.length ? "incomplete" : "valid";
    if (missing.length) reasons.push(`Missing required field${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`);

    const confidence = Math.min(recordConfidence(candidate, present.map((p) => p.field!)), candidate.maxConfidence ?? 1);
    return { ...candidate, status, rejectReasons: reasons, confidence };
  });

type Field = Candidate["item"]["fields"][string];

function hasVerifiedValue(field: Field): boolean {
  if (!field || !field.evidence.verified) return false;
  return typeof field.value === "boolean" || String(field.value ?? "").trim() !== "";
}

function recordConfidence(candidate: Candidate, required: NonNullable<Field>[]): number {
  const scored = (required.length ? required : Object.values(candidate.item.fields).filter(Boolean)) as NonNullable<Field>[];
  if (scored.length === 0) return 0;
  return Math.min(...scored.map((f) => fieldConfidence(f.evidence.method, f.evidence.verified)));
}
