import clsx from "clsx";
import { Tooltip } from "radix-ui";

export interface Bar {
  label: string;
  value: number;
  /** Text shown at the end of the bar, e.g. "84%" or "1,204". */
  display: string;
  /** Extra detail for the hover tooltip. */
  detail?: string;
}

/**
 * Horizontal bars for one series: thin marks with rounded data ends, the exact value as
 * text beside each (so the chart doubles as a table), and a tooltip on hover or focus.
 */
export function BarList({
  bars,
  max,
  tone = "accent",
  labelWidth = "12rem",
  ariaLabel,
}: {
  bars: Bar[];
  max?: number;
  tone?: "accent" | "neutral";
  labelWidth?: string;
  ariaLabel: string;
}) {
  const top = max ?? Math.max(1, ...bars.map((b) => b.value));
  return (
    <ul className="space-y-1.5" aria-label={ariaLabel}>
      {bars.map((bar) => (
        <Tooltip.Root key={bar.label}>
          <Tooltip.Trigger asChild>
            <li
              tabIndex={0}
              className="grid items-center gap-3 rounded-sm py-0.5 text-sm outline-none hover:bg-surface focus-visible:bg-surface"
              style={{ gridTemplateColumns: `${labelWidth} 1fr 4.5rem` }}
            >
              <span className="truncate text-ink" title={bar.label}>
                {bar.label}
              </span>
              <span className="h-2.5 overflow-hidden rounded-r bg-rule/50" aria-hidden>
                <span
                  className={clsx("block h-full rounded-r", tone === "accent" ? "bg-accent" : "bg-derived")}
                  style={{ width: `${Math.max(bar.value > 0 ? 1.5 : 0, (bar.value / top) * 100)}%` }}
                />
              </span>
              <span className="text-right tabular-nums text-muted">{bar.display}</span>
            </li>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content side="top" sideOffset={4} className="rounded border border-rule bg-surface px-2.5 py-1.5 text-xs text-ink shadow-sm">
              <span className="font-medium">{bar.label}</span>: {bar.display}
              {bar.detail && <span className="block text-muted">{bar.detail}</span>}
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      ))}
    </ul>
  );
}
