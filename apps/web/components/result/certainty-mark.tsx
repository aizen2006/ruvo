import { Tooltip } from "@/components/ui/tooltip";
import { CERTAINTY_HINT, CERTAINTY_LABEL, certaintyOf, type Certainty } from "@/lib/plain";
import { cn } from "@/lib/utils";

// A three-cell dot-matrix meter: how many cells are lit, and in which meaning colour.
const LIT = { sure: 3, likely: 2, check: 1 };
const TONE = { sure: "bg-stamp", likely: "bg-graphite", check: "bg-amber" };

/** How sure RUVO is of a value or a row: Sure, Likely or Check this, always with the word so colour is never alone. */
export function CertaintyMark({ confidence, certainty }: { confidence?: number; certainty?: Certainty }) {
  const level = certainty ?? certaintyOf(confidence ?? 0);
  return (
    <Tooltip content={CERTAINTY_HINT[level]}>
      <span tabIndex={0} className="inline-flex items-center gap-1.5 rounded-control font-mono text-micro whitespace-nowrap">
        <span className="flex gap-0.5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span key={i} className={cn("size-1.5", i < LIT[level] ? TONE[level] : "bg-hairline-strong")} />
          ))}
        </span>
        {CERTAINTY_LABEL[level]}
      </span>
    </Tooltip>
  );
}
