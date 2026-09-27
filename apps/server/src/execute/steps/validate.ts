import { canonicalUrl } from "../../libs/url";
import { fieldText } from "../candidate";
import { itemKeyFor } from "../contractFields";
import type { StepFn } from "./types";

/**
 * Assigns each candidate a status:
 * - invalid: a hard criterion failed or the URL is unusable
 * - incomplete: a required field is missing
 * - valid: everything required is present and every hard criterion passed
 */
export const validate: StepFn<"validate"> = async (ctx, _branch, step, input) =>
  input.map((candidate) => {
    const reasons = [...candidate.rejectReasons];
    const missing = step.required.filter((name) => !fieldText(candidate, itemKeyFor(ctx.contract, name)).trim());

    const url = fieldText(candidate, "url");
    if (url && !canonicalUrl(url)) reasons.push("URL is not a valid http(s) link");

    const status = reasons.length ? "invalid" : missing.length ? "incomplete" : "valid";
    if (missing.length) reasons.push(`Missing required field${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`);
    return { ...candidate, status, rejectReasons: reasons };
  });
