import type { RunDetail } from "@repo/contracts";
import { duration, formatNumber, formatUsd } from "@/lib/format";

/** The run's key numbers as one compact line of labelled values. */
export function MetricsLine({ run }: { run: RunDetail }) {
  const m = run.metrics;
  const items: Array<[string, string]> = [
    ["Valid records", formatNumber(m.validRecords)],
    ["Incomplete", formatNumber(m.incompleteRecords)],
    ["Rejected", formatNumber(m.invalidRecords)],
    ["Duplicates merged", formatNumber(m.duplicates)],
    ["Pages fetched", `${formatNumber(m.pagesVisited)}${m.cacheHits ? ` (+${m.cacheHits} cached)` : ""}`],
    ["Browser pages", formatNumber(m.browserPages)],
    ["LLM usage", `${formatNumber(m.llmCalls)} calls, ${formatUsd(m.llmCostUsd)}`],
  ];
  const elapsed = duration(run.startedAt, run.finishedAt);
  if (elapsed) items.push(["Collection time", elapsed]);

  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-3 border-y border-rule py-3">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs text-muted">{label}</dt>
          <dd className="text-lg font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
