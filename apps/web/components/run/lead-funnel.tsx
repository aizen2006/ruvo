import type { DatasetContract, RunDetail, RunFunnel } from "@repo/contracts";
import { ChevronRight } from "lucide-react";
import { columnName } from "@/components/plan/column-chips";
import { Tooltip } from "@/components/ui/tooltip";
import { formatNumber } from "@/lib/format";

const STEPS: Array<{ key: Exclude<keyof RunFunnel, "biggestLoss">; label: string; hint: string }> = [
  { key: "searched", label: "Searched", hint: "Web searches RUVO ran to find places to look" },
  { key: "sources", label: "Sources", hint: "Places RUVO planned to read" },
  { key: "collected", label: "Collected", hint: "Rows read from those places" },
  { key: "qualified", label: "Qualified", hint: "Rows that meet every must have" },
  { key: "complete", label: "Complete", hint: "Qualified rows with every must-have value" },
  { key: "ready", label: "Ready leads", hint: "Complete rows, with duplicates merged" },
];

/** The step that lost the most, said like "2,495 of 2,520 failed: Suitable for two years' experience". */
function lossLine({ step, count, of, reason }: NonNullable<RunFunnel["biggestLoss"]>, contract: DatasetContract | null) {
  const share = `${formatNumber(count)} of ${formatNumber(of)}`;
  if (step === "ready") return `${share} were duplicates`;
  if (step === "qualified") return reason ? `${share} failed: ${reason}` : `${share} failed a must have`;
  const field = contract?.fields.find((f) => f.name === reason);
  return reason ? `${share} were missing: ${field ? columnName(field) : reason}` : `${share} were missing a must-have value`;
}

/** From the searches to the ready leads, with the count at each step and where most were lost. */
export function LeadFunnel({ run }: { run: RunDetail }) {
  const { funnel } = run;
  return (
    <section aria-label="From searches to leads" className="space-y-tight">
      <ol className="flex flex-wrap gap-x-item gap-y-tight">
        {STEPS.map((s, i) => (
          <li key={s.key} className="flex items-end gap-x-item">
            {i > 0 && <ChevronRight className="mb-1 size-4 text-pencil" aria-hidden />}
            <Tooltip content={s.hint}>
              <span tabIndex={0} className="rounded-control">
                <span className="block font-mono text-micro text-graphite">{s.label}</span>
                <span className="block font-mono text-heading tabular">{formatNumber(funnel[s.key])}</span>
              </span>
            </Tooltip>
          </li>
        ))}
      </ol>
      {funnel.biggestLoss && (
        <p className="flex flex-wrap items-baseline gap-x-tight text-small">
          <span className="font-mono text-micro text-graphite">Biggest drop</span>
          {lossLine(funnel.biggestLoss, run.contract)}
        </p>
      )}
    </section>
  );
}
