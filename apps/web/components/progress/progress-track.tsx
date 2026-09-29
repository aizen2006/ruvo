import type { RunStatus, Stage } from "@repo/contracts";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = ["Understanding", "Finding sources", "Reading pages", "Checking", "Ready"] as const;

/** Which of the five steps a run is on; the last one is only reached when it completed. */
export function stepOf(status: RunStatus, stage: Stage): number {
  if (status === "completed") return 4;
  if (status === "queued" || status === "compiling" || stage === "understanding") return 0;
  if (status === "planning" || status === "awaiting_approval" || stage === "planning" || stage === "discovering") return 1;
  if (stage === "collecting" || stage === "extracting" || status === "queued_run") return 2;
  return 3;
}

/**
 * Five numbered steps as one thick ink-framed bar: done steps are filled with highlighter, the
 * current one fills slowly (the one choreographed moment of this screen, stilled for reduced motion).
 */
export function ProgressTrack({ status, stage }: { status: RunStatus; stage: Stage }) {
  const current = stepOf(status, stage);
  return (
    <ol className="grid grid-cols-5" aria-label="Progress">
      {STEPS.map((label, i) => {
        const done = i < current || status === "completed";
        const active = i === current && status !== "completed";
        return (
          <li key={label} className="space-y-tight" aria-current={active ? "step" : undefined}>
            <div className="relative h-6 overflow-hidden border-y-[3px] border-l-[3px] border-ink bg-newsprint [li:last-child_&]:border-r-[3px]">
              {done && <div className="absolute inset-0 bg-highlighter" />}
              {active && <div className="absolute inset-y-0 left-0 w-full origin-left animate-[fill_12s_var(--ease-standard)_forwards] bg-highlighter" />}
            </div>
            <p className={cn("flex items-baseline gap-1.5 pr-1 text-micro sm:text-small", done || active ? "text-ink" : "text-pencil", active && "font-bold")}>
              <span className="font-display text-heading font-black tabular" aria-hidden>
                {i + 1}
              </span>
              <span className="truncate">{label}</span>
              {done && <Check className="hidden size-3.5 shrink-0 self-center text-stamp sm:block" aria-hidden />}
              {done && <span className="sr-only">(done)</span>}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
