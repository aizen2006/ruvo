import type { SourceBranch, Step } from "@repo/contracts";
import type { RunContext } from "../../runs/runContext";
import type { Candidate } from "../candidate";

/** A pipeline step: transforms the candidates of one source branch. */
export type StepFn<K extends Step["kind"]> = (
  ctx: RunContext,
  branch: SourceBranch,
  step: Extract<Step, { kind: K }>,
  input: Candidate[],
) => Promise<Candidate[]>;
