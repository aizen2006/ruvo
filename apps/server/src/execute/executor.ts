import type { SourceBranch, Stage, Step } from "@repo/contracts";
import { mapLimit } from "../libs/limit";
import type { RunContext } from "../runs/runContext";
import type { Candidate } from "./candidate";
import { buildQualityReport } from "./quality";
import { collect } from "./steps/collect";
import { dedupeRun } from "./steps/dedupe";
import { enrich } from "./steps/enrich";
import { extractText } from "./steps/extractText";
import { match } from "./steps/match";
import { prefilter } from "./steps/prefilter";
import { store } from "./steps/store";
import { triage } from "./steps/triage";
import { validate } from "./steps/validate";

/** How many source branches run at once; per-host politeness is enforced by the fetcher. */
const BRANCH_CONCURRENCY = 3;

/**
 * Executes a compiled WorkflowIR. Each source branch runs its steps in order; a failing
 * branch is reported and skipped so one broken source never sinks the whole run.
 */
export async function executeWorkflow(ctx: RunContext): Promise<void> {
  await ctx.setStage("collecting");
  const outcomes = await mapLimit(ctx.ir.sources, BRANCH_CONCURRENCY, (branch) => runBranch(ctx, branch));

  const failed = outcomes.filter((ok) => !ok).length;
  if (ctx.ir.sources.length > 0 && failed === ctx.ir.sources.length) {
    throw new Error("Every source failed; see the run events for details");
  }

  await ctx.setStage("deduplicating");
  const duplicates = await dedupeRun(ctx);
  ctx.emit({ stage: "deduplicating", type: "dedupe.completed", message: `${duplicates} duplicate records merged` });

  await buildQualityReport(ctx);
  const m = ctx.metrics.snapshot();
  ctx.emit({
    stage: "done",
    type: "run.summary",
    message: `${m.validRecords} valid, ${m.incompleteRecords} incomplete, ${m.invalidRecords} rejected, ${m.duplicates} duplicates, from ${ctx.ir.sources.length - failed} sources`,
    data: { failedSources: failed },
  });
}

/** Returns false if the branch failed (the error is recorded as an event). */
async function runBranch(ctx: RunContext, branch: SourceBranch): Promise<boolean> {
  let candidates: Candidate[] = [];
  for (const step of branch.steps) {
    ctx.signal.throwIfAborted();
    const started = Date.now();
    try {
      candidates = await runStep(ctx, branch, step, candidates);
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      const message = err instanceof Error ? err.message : String(err);
      ctx.emit({
        stage: stageOf(step),
        type: "source.failed",
        level: "error",
        sourceId: branch.id,
        message: `${branch.label} failed at ${step.kind}: ${message}`,
        data: { stepId: step.id, kind: step.kind, error: message, errorKind: (err as { kind?: string }).kind ?? null },
      });
      return false;
    }
    ctx.emit({
      stage: stageOf(step),
      type: "step.completed",
      sourceId: branch.id,
      message: `${branch.label} · ${step.kind} → ${candidates.length}`,
      data: { stepId: step.id, kind: step.kind, count: candidates.length, ms: Date.now() - started },
    });
  }
  return true;
}

function runStep(ctx: RunContext, branch: SourceBranch, step: Step, input: Candidate[]): Promise<Candidate[]> {
  switch (step.kind) {
    case "collect":
      return collect(ctx, branch, step, input);
    case "prefilter":
      return prefilter(ctx, branch, step, input);
    case "triage":
      return triage(ctx, branch, step, input);
    case "extract_text":
      return extractText(ctx, branch, step, input);
    case "enrich":
      return enrich(ctx, branch, step, input);
    case "match":
      return match(ctx, branch, step, input);
    case "validate":
      return validate(ctx, branch, step, input);
    case "store":
      return store(ctx, branch, step, input);
    default: {
      // Every Step kind is handled above; adding a kind makes this a compile error.
      const unhandled: never = step;
      throw new Error(`Unknown step ${JSON.stringify(unhandled)}`);
    }
  }
}

/** The user-facing stage a step belongs to. */
export function stageOf(step: Step): Stage {
  switch (step.kind) {
    case "collect":
      return "collecting";
    case "validate":
    case "store":
      return "validating";
    default:
      return "extracting";
  }
}
