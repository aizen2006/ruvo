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
              className="grid items-center gap-3 py-0.5 text-small outline-none hover:bg-sheet focus-visible:bg-sheet"
              style={{ gridTemplateColumns: `${labelWidth} 1fr 4.5rem` }}
            >
              <span className="truncate text-ink" title={bar.label}>
                {bar.label}
              </span>
              <span className="h-2 overflow-hidden bg-hairline/50" aria-hidden>
                <span
                  className={clsx("block h-full", tone === "accent" ? "bg-ink" : "bg-derived")}
                  style={{ width: `${Math.max(bar.value > 0 ? 1.5 : 0, (bar.value / top) * 100)}%` }}
                />
              </span>
              <span className="text-right font-mono tabular-nums text-graphite">{bar.display}</span>
            </li>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content side="top" sideOffset={4} className="rounded-control bg-ink px-3 py-2 text-micro text-sheet shadow-raised">
              <span className="font-medium">{bar.label}</span>: {bar.display}
              {bar.detail && <span className="block text-sheet/75">{bar.detail}</span>}
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      ))}
    </ul>
  );
}
