import { getAdapter } from "../../adapters";
import { toCandidate } from "../candidate";
import type { StepFn } from "./types";

/** Runs the branch's source adapter. The step's `maxItems` cap is applied after prefiltering. */
export const collect: StepFn<"collect"> = async (ctx, branch, step) => {
  const adapter = getAdapter(step.adapter);
  const params = adapter.params.parse(step.params);
  const items = await adapter.collect({ fetcher: ctx.fetcher, scope: ctx }, params);

  ctx.emit({
    stage: "collecting",
    type: "source.collected",
    sourceId: branch.id,
    message: `${branch.label}: ${items.length} postings found`,
    data: { count: items.length },
  });
  return items.map((item) => toCandidate(branch.id, item));
};
