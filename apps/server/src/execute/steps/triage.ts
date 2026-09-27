import { noulBand, type DecisionRequest } from "../../decide/decider";
import { truncate } from "../../libs/text";
import { fieldText, type Candidate } from "../candidate";
import { compileKeywords } from "../keywords";
import type { StepFn } from "./types";

type Label = "yes" | "no" | "unknown";

/**
 * Decides which posts from a free-text source are relevant before any LLM extraction.
 * Posts whose parsed header already shows the title are settled by the contract's role
 * keywords; the rest go to the decision layer. Irrelevant posts are dropped; the others
 * carry their verdict so extraction handles the most relevant first.
 */
export const triage: StepFn<"triage"> = async (ctx, branch, _step, input) => {
  const roleKeywords = compileKeywords(
    ctx.contract.criteria.filter((c) => c.kind === "keyword_any" && c.strength === "hard").flatMap((c) => c.values),
  );
  const question =
    ctx.contract.criteria.find((c) => c.kind === "semantic")?.values[0] ??
    `Is this a job posting for the kind of role described here: ${ctx.contract.title}?`;

  const requests = input.map(
    (c): DecisionRequest<Label> => ({
      task: "RELEVANCE",
      subject: fieldText(c, "title") || c.key,
      state: truncate(c.item.text?.plain ?? "", 1000),
      question: { type: "noul", instructions: question },
      labels: ["yes", "no", "unknown"],
      rule: () => {
        const title = fieldText(c, "title");
        if (!title || !roleKeywords) return null;
        return roleKeywords.test(title) ? "yes" : "no";
      },
      band: noulBand(0.75, 0.25),
      defaultLabel: "unknown",
    }),
  );
  const verdicts = await ctx.decider.decideMany(ctx, requests);

  const kept: Candidate[] = [];
  input.forEach((c, i) => {
    const v = verdicts[i]!;
    if (v.label === "no") return;
    kept.push({ ...c, item: { ...c.item, meta: { ...c.item.meta, triage: { label: v.label, confidence: v.confidence, decidedBy: v.decidedBy } } } });
  });
  // Relevant first, then undecided, so a limited LLM allowance goes where it matters.
  kept.sort((a, b) => Number((b.item.meta.triage as { label: Label }).label === "yes") - Number((a.item.meta.triage as { label: Label }).label === "yes"));

  const tally = (tier: string) => verdicts.filter((v) => v.decidedBy === tier).length;
  ctx.emit({
    stage: "extracting",
    type: "triage.completed",
    sourceId: branch.id,
    message: `${branch.label}: kept ${kept.length} of ${input.length} posts (rules ${tally("RULES")}, decision model ${tally("DECIDER")}, LLM ${tally("LLM")})`,
    data: { input: input.length, kept: kept.length },
  });
  return kept;
};
