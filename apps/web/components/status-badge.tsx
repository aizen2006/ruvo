import type { RunStatus } from "@repo/contracts";
import clsx from "clsx";
import { STATUS_LABEL, STATUS_TONE, type StatusTone } from "@/lib/format";

const TONE: Record<StatusTone, { dot: string; text: string }> = {
  neutral: { dot: "bg-faint", text: "text-muted" },
  active: { dot: "bg-accent animate-pulse", text: "text-ink" },
  attention: { dot: "bg-pattern", text: "text-pattern" },
  success: { dot: "bg-accent", text: "text-accent" },
  danger: { dot: "bg-danger", text: "text-danger" },
};

export function StatusBadge({ status }: { status: RunStatus }) {
  const tone = TONE[STATUS_TONE[status]];
  return (
    <span className={clsx("inline-flex items-center gap-2 text-sm whitespace-nowrap", tone.text)}>
      <span className={clsx("size-2 rounded-full", tone.dot)} aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}
