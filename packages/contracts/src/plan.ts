import { z } from "zod";

/** Rungs of the extraction ladder, cheapest and most reliable first. */
export const Rung = z.enum(["json_ld", "regex", "llm"]);
export type Rung = z.infer<typeof Rung>;

/**
 * The only thing the planner LLM writes. It chooses among discovered sources and strategies;
 * the server's IR compiler turns it into an executable WorkflowIR. Strict-mode safe.
 */
export const PlanDraft = z.object({
  sources: z.array(
    z.object({
      ref: z.string().describe("Id of a discovered candidate source"),
      include: z.boolean(),
      reason: z.string(),
      titleKeywords: z.array(z.string()),
      fetchDetails: z.boolean(),
      maxItems: z.number(),
    }),
  ),
  llmBudget: z.number(),
  rationale: z.string(),
});
export type PlanDraft = z.infer<typeof PlanDraft>;
