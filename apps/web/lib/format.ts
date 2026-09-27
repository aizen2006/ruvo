import type { RunStatus } from "@repo/contracts";

/** Plain-language names for run statuses, as a user would describe them. */
export const STATUS_LABEL: Record<RunStatus, string> = {
  queued: "Waiting to start",
  compiling: "Understanding request",
  planning: "Planning",
  awaiting_approval: "Ready for review",
  queued_run: "Waiting to collect",
  running: "Collecting",
  completed: "Complete",
  failed: "Failed",
  cancelled: "Cancelled",
};

export type StatusTone = "neutral" | "active" | "attention" | "success" | "danger";

export const STATUS_TONE: Record<RunStatus, StatusTone> = {
  queued: "neutral",
  compiling: "active",
  planning: "active",
  awaiting_approval: "attention",
  queued_run: "neutral",
  running: "active",
  completed: "success",
  failed: "danger",
  cancelled: "neutral",
};

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return RELATIVE.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

export const formatNumber = (n: number) => n.toLocaleString("en-US");

export const formatUsd = (n: number) => (n < 0.01 && n > 0 ? "< $0.01" : `$${n.toFixed(2)}`);

export function duration(fromIso: string | null, toIso: string | null): string | null {
  if (!fromIso) return null;
  const ms = (toIso ? new Date(toIso).getTime() : Date.now()) - new Date(fromIso).getTime();
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
