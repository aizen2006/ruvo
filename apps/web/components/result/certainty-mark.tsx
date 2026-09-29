import { CircleAlert, CircleCheck, CircleDot } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { CERTAINTY_HINT, CERTAINTY_LABEL, certaintyOf, type Certainty } from "@/lib/plain";

const TONE = { sure: "sure", likely: "neutral", check: "check" } as const;
const ICON = { sure: CircleCheck, likely: CircleDot, check: CircleAlert };

/** How sure RUVO is of a value or a row: Sure, Likely or Check this, with an icon so colour is never alone. */
export function CertaintyMark({ confidence, certainty }: { confidence?: number; certainty?: Certainty }) {
  const level = certainty ?? certaintyOf(confidence ?? 0);
  const Icon = ICON[level];
  return (
    <Tooltip content={CERTAINTY_HINT[level]}>
      <Badge tone={TONE[level]} tabIndex={0}>
        <Icon aria-hidden />
        {CERTAINTY_LABEL[level]}
      </Badge>
    </Tooltip>
  );
}
