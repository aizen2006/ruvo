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
 * Five plain steps on the black collecting panel, each a dot-matrix bar that fills with the
 * signal: done steps are full, the current one fills slowly (stilled for reduced motion).
 */
export function ProgressTrack({ status, stage }: { status: RunStatus; stage: Stage }) {
  const current = stepOf(status, stage);
  return (
    <ol className="grid grid-cols-5 gap-tight" aria-label="Progress">
      {STEPS.map((label, i) => {
        const done = i < current || status === "completed";
        const active = i === current && status !== "completed";
        return (
          <li key={label} className="space-y-tight" aria-current={active ? "step" : undefined}>
            {/* Cut into 4px cells so the bar reads as a row of dots. */}
            <div className="relative h-2 overflow-hidden bg-sheet/20 [mask-image:linear-gradient(90deg,black_4px,transparent_4px)] [mask-size:6px_100%]">
              {done && <div className="absolute inset-0 bg-highlighter" />}
              {active && <div className="absolute inset-y-0 left-0 w-full origin-left animate-[fill_12s_var(--ease-standard)_forwards] bg-highlighter" />}
            </div>
            <p className={cn("flex items-center gap-1 font-mono text-micro", done || active ? "text-sheet" : "text-sheet/50", active && "font-medium")}>
              {done && <Check className="hidden size-3.5 shrink-0 sm:block" aria-hidden />}
              <span className="truncate">{label}</span>
              {done && <span className="sr-only">(done)</span>}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
