import { choiceBand, type DecisionRequest, type DecisionScope, type Decider } from "../decide/decider";
import type { Failure } from "./classify";

export const REPAIR_ACTIONS = ["RETRY", "SWITCH_TO_BROWSER", "CHANGE_SELECTOR", "ESCALATE", "STOP"] as const;
export type RepairAction = (typeof REPAIR_ACTIONS)[number];

/** What each action means, shown to the decision model as the choice criteria. */
const MEANING: Record<RepairAction, string> = {
  RETRY: "try the same request again; the failure looks temporary",
  SWITCH_TO_BROWSER: "the page needs JavaScript; render it in a browser",
  CHANGE_SELECTOR: "the page layout shifted slightly; adjust the recorded selectors locally",
  ESCALATE: "the page was redesigned; ask the LLM to work out a new recipe",
  STOP: "give up on this source for this run",
};

export interface RepairContext {
  failure: Failure;
  via: "http" | "browser";
  /** Items the recipe found vs. the last successful run, for the decision model. */
  itemsFound: number;
  itemsExpected: number | null;
  attempt: number;
}

/**
 * Chooses how to repair a failing source. Unambiguous cases are rules (a blocked site is
 * never worked around); selector problems go to the decision model, which weighs a cheap
 * local fix against LLM rediscovery.
 */
export async function chooseRepair(decider: Decider, scope: DecisionScope, subject: string, c: RepairContext): Promise<{ action: RepairAction; decidedBy: string }> {
  const request: DecisionRequest<RepairAction> = {
    task: "REPAIR_ACTION",
    subject,
    state: [
      `failure=${c.failure.kind}`,
      `detail=${c.failure.detail}`,
      `fetched_via=${c.via}`,
      `items_found=${c.itemsFound}`,
      `items_last_time=${c.itemsExpected ?? "unknown"}`,
      `attempt=${c.attempt}`,
    ].join("\n"),
    question: { type: "choice", instructions: "How should this failing web source be repaired?", criteria: MEANING },
    labels: REPAIR_ACTIONS,
    rule: () => ruleFor(c),
    band: choiceBand(REPAIR_ACTIONS, 0.6),
    defaultLabel: c.attempt > 1 ? "STOP" : "ESCALATE",
  };
  const [decision] = await decider.decideMany(scope, [request]);
  return { action: decision!.label, decidedBy: decision!.decidedBy };
}

/** The cases that need no judgement. */
function ruleFor(c: RepairContext): RepairAction | null {
  if (c.attempt > 2) return "STOP";
  switch (c.failure.kind) {
    case "BLOCKED":
    case "BUDGET":
      return "STOP";
    case "HTTP_ERROR":
    case "RATE_LIMITED":
      return c.attempt > 1 ? "STOP" : "RETRY";
    case "EMPTY_RENDER":
      return c.via === "http" ? "SWITCH_TO_BROWSER" : "ESCALATE";
    default:
      return null; // selector problems: let the decision model weigh a local fix against rediscovery
  }
}
