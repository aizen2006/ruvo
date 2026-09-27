import type { RunDetail } from "@repo/contracts";
import clsx from "clsx";

const STEPS = [
  { key: "understanding", label: "Understand" },
  { key: "planning", label: "Plan" },
  { key: "review", label: "Review" },
  { key: "collecting", label: "Collect" },
  { key: "extracting", label: "Extract" },
  { key: "validating", label: "Validate" },
  { key: "deduplicating", label: "Deduplicate" },
  { key: "done", label: "Done" },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

/** Where the run is in the pipeline, derived from its status and current stage. */
function currentStep(run: RunDetail): StepKey {
  switch (run.status) {
    case "queued":
    case "compiling":
    case "planning":
      return run.stage === "planning" ? "planning" : "understanding";
    case "awaiting_approval":
      return "review";
    case "queued_run":
      return "collecting";
    case "completed":
      return "done";
    default:
      return (STEPS.find((s) => s.key === run.stage)?.key ?? "collecting") as StepKey;
  }
}

export function StageTimeline({ run }: { run: RunDetail }) {
  const current = STEPS.findIndex((s) => s.key === currentStep(run));
  const stopped = run.status === "failed" || run.status === "cancelled";
  const finished = run.status === "completed";

  return (
    <ol className="grid grid-cols-4 gap-y-3 sm:grid-cols-8" aria-label="Run progress">
      {STEPS.map((step, i) => {
        const done = finished || i < current;
        const active = !finished && i === current;
        return (
          <li key={step.key} className="flex items-center gap-2" aria-current={active ? "step" : undefined}>
            <span
              className={clsx(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                done && "bg-accent text-white",
                active && !stopped && "border-2 border-accent text-accent",
                active && stopped && "border-2 border-danger text-danger",
                !done && !active && "border border-rule-strong text-faint",
              )}
            >
              {i + 1}
            </span>
            <span className={clsx("text-sm", done || active ? "text-ink" : "text-faint", active && "font-medium")}>{step.label}</span>
            {i < STEPS.length - 1 && <span className={clsx("hidden h-px flex-1 sm:block", done ? "bg-accent" : "bg-rule")} aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
