import { fieldText } from "../candidate";
import { compileKeywords } from "../keywords";
import type { StepFn } from "./types";

/**
 * Cheap keyword gate before any expensive work: keeps candidates whose fields contain
 * one of `keywordsAny` and none of `keywordsNone` (all of them when there are no keywords),
 * then applies the branch's item cap.
 */
export const prefilter: StepFn<"prefilter"> = async (ctx, branch, step, input) => {
  const include = compileKeywords(step.keywordsAny);
  const exclude = compileKeywords(step.keywordsNone);

  const matching = input.filter((c) => {
    const text = step.fields.map((f) => fieldText(c, f)).join(" \n ");
    return (!include || include.test(text)) && !(exclude && exclude.test(text));
  });

  const collectStep = branch.steps.find((s) => s.kind === "collect");
  const cap = collectStep?.kind === "collect" ? collectStep.maxItems : matching.length;
  const kept = matching.slice(0, cap);

  ctx.metrics.inc("rawRecords", kept.length);
  const found = include || exclude ? `${matching.length} of ${input.length} match the role keywords` : `${input.length} collected`;
  ctx.emit({
    stage: "extracting",
    type: "source.prefiltered",
    sourceId: branch.id,
    message: `${branch.label}: ${found}${kept.length < matching.length ? `, keeping ${kept.length}` : ""}`,
    data: { input: input.length, matching: matching.length, kept: kept.length },
  });
  return kept;
};
