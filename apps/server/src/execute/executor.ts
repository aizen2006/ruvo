import type { SourceBranch, Stage, Step } from "@repo/contracts";
import { mapLimit } from "../libs/limit";
import type { RunContext } from "../runs/runContext";
import type { Candidate } from "./candidate";
import { buildRunDiff } from "./diff";
import { explainFailure } from "../repair/classify";
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
  // The run's time limit stops slow work (collection, enrichment) but still saves what was gathered.
  const deadline = AbortSignal.timeout(ctx.ir.budgets.maxDurationMs);
  const outcomes = await mapLimit(ctx.ir.sources, BRANCH_CONCURRENCY, (branch) => runBranch(ctx, branch, deadline));

  const failures = outcomes.filter((reason): reason is string => reason !== null);
  const failed = failures.length;
  if (ctx.ir.sources.length > 0 && failed === ctx.ir.sources.length) {
    throw new Error(failed === 1 ? failures[0] : `None of the ${failed} sources could be collected; the Workflow tab shows why for each`);
  }

  await ctx.setStage("deduplicating");
  const duplicates = await dedupeRun(ctx);
  ctx.emit({ stage: "deduplicating", type: "dedupe.completed", message: `${duplicates} duplicate records merged` });

  await buildQualityReport(ctx);
  const diff = await buildRunDiff(ctx);
  if (diff.previousRunId) {
    const c = diff.counts;
    ctx.emit({
      stage: "done",
      type: "diff.completed",
      message: `Since the previous run: ${c.added} new, ${c.removed} gone, ${c.changed} changed, ${c.unchanged} unchanged`,
      data: c,
    });
  }
  const m = ctx.metrics.snapshot();
  ctx.emit({
    stage: "done",
    type: "run.summary",
    message: `${m.validRecords} valid, ${m.incompleteRecords} incomplete, ${m.invalidRecords} rejected, ${m.duplicates} duplicates, from ${ctx.ir.sources.length - failed} sources`,
    data: { failedSources: failed },
  });
}

/** Steps that turn what was already gathered into saved records; they still run after the time limit. */
const FINISHING_STEPS: ReadonlySet<Step["kind"]> = new Set(["prefilter", "match", "validate", "store"]);

/**
 * Runs one source's steps. Returns why the source failed (also recorded as an event), or null. Once
 * the run's time limit passes, slow steps are skipped and the rest save what was gathered.
 */
async function runBranch(ctx: RunContext, branch: SourceBranch, deadline: AbortSignal): Promise<string | null> {
  const timed: RunContext = { ...ctx, signal: AbortSignal.any([ctx.signal, deadline]) };
  let candidates: Candidate[] = [];
  let outOfTime = false;
  const stopSlowWork = (step: Step) => {
    outOfTime = true;
    ctx.emit({
      stage: stageOf(step),
      type: "source.time_limit",
      level: "warn",
      sourceId: branch.id,
      message: `${branch.label}: the run's ${Math.round(ctx.ir.budgets.maxDurationMs / 60_000)}-minute time limit was reached; saving what was gathered`,
      data: { stepId: step.id, kind: step.kind },
    });
  };

  for (const step of branch.steps) {
    ctx.signal.throwIfAborted();
    if (!outOfTime && deadline.aborted) stopSlowWork(step);
    if (outOfTime && !FINISHING_STEPS.has(step.kind)) continue;
    const started = Date.now();
    try {
      candidates = await runStep(outOfTime ? ctx : timed, branch, step, candidates);
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      if (deadline.aborted && !outOfTime) {
        // The limit interrupted this step; keep its input and finish with the saving steps.
        stopSlowWork(step);
        continue;
      }
      const reason = `${branch.label} could not be collected: ${explainFailure(err)}`;
      const detail = err instanceof Error ? err.message : String(err);
      ctx.emit({
        stage: stageOf(step),
        type: "source.failed",
        level: "error",
        sourceId: branch.id,
        message: reason,
        data: { stepId: step.id, kind: step.kind, error: detail, errorKind: (err as { kind?: string }).kind ?? null },
      });
      return reason;
    }
    ctx.emit({
      stage: stageOf(step),
      type: "step.completed",
      sourceId: branch.id,
      message: `${branch.label} · ${step.kind} → ${candidates.length}`,
      data: { stepId: step.id, kind: step.kind, count: candidates.length, ms: Date.now() - started },
    });
  }
  return null;
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
