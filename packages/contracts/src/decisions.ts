import { z } from "zod";

const Tier = z.enum(["RULES", "DECIDER", "LLM", "DEFAULT"]);

/** How a run's decisions were made, for the Decisions panel. */
export const DecisionSummary = z.object({
  total: z.number(),
  byTier: z.record(Tier, z.number()),
  byTask: z.array(z.object({ task: z.string(), total: z.number(), byTier: z.record(Tier, z.number()) })),
  /** Cases where the decision model answered but the LLM judge decided: did they agree? */
  agreement: z.object({ compared: z.number(), agreed: z.number() }),
  providerModel: z.string().nullable(),
  samples: z.array(
    z.object({
      task: z.string(),
      subject: z.string(),
      question: z.string().nullable(),
      label: z.string(),
      confidence: z.number(),
      decidedBy: Tier,
      shadow: z.object({ label: z.string(), confidence: z.number() }).nullable(),
    }),
  ),
});
export type DecisionSummary = z.infer<typeof DecisionSummary>;
