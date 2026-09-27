import type { Env } from "../config/env";
import saved from "./calibration.json";
import type { DecisionTask } from "./decider";

/**
 * Per-task confidence thresholds for the decision model, produced by
 * scripts/calibrate-decider.ts. Tasks without calibration use conservative defaults.
 */
export interface TaskCalibration {
  /** Accept "yes" when P(true) is at least this. */
  yes: number;
  /** Accept "no" when P(true) is at most this. */
  no: number;
  /** shadow when the model decided too few cases confidently during calibration. */
  mode: Env["DECIDER_MODE"];
  model: string;
  precision: number;
  coverage: number;
  samples: number;
  calibratedAt: string;
}

const DEFAULT = { yes: 0.8, no: 0.2 };
const calibration = saved as Partial<Record<DecisionTask, TaskCalibration>>;

export const thresholdsFor = (task: DecisionTask) => calibration[task] ?? DEFAULT;

/** The effective mode for a task: calibration can only make it more cautious than the global mode. */
export function modeFor(task: DecisionTask, globalMode: Env["DECIDER_MODE"]): Env["DECIDER_MODE"] {
  const taskMode = calibration[task]?.mode;
  if (globalMode === "off" || taskMode === "off") return "off";
  if (globalMode === "shadow" || taskMode === "shadow") return "shadow";
  return "active";
}
