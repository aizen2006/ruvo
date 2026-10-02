"use client";

import { estimateRunCost, type RunDetail, type WorkflowIR } from "@repo/contracts";
import { costRange, minutesPhrase, usd } from "@/lib/plain";
import { useRunOptions } from "@/lib/queries";

/**
 * What starting will cost and take. Understanding and planning are already paid for; the rest is
 * an estimate for collecting, with an upper figure for a run that uses its whole AI allowance.
 * On a ChatGPT plan the AI calls are included, so there is nothing to estimate.
 */
export function PlanFacts({ run, ir }: { run: RunDetail; ir: WorkflowIR }) {
  const { data: options } = useRunOptions();
  const included = options?.account === "chatgpt";
  const estimate = options ? estimateRunCost(run.models, ir.budgets.maxLlmCalls, options.models) : null;
  const collecting = estimate && {
    typical: Math.max(0, estimate.typicalUsd - estimate.setupUsd),
    high: Math.max(0, estimate.highUsd - estimate.setupUsd),
  };

  const facts: Array<[label: string, value: string]> = [
    ["Collecting costs", included ? "Included in your ChatGPT plan" : collecting ? costRange(collecting.typical, collecting.high) : "shown once estimates load"],
    // With an API key, nothing spent means the request was answered from RUVO's cache of earlier answers.
    ["Already spent", run.costUsd > 0 ? `${usd(run.costUsd)} to understand and plan` : included ? "nothing" : "nothing: answered from earlier work"],
    ["Takes", minutesPhrase(ir.budgets.maxDurationMs)],
    ["Keeps", `up to ${ir.budgets.maxRecords.toLocaleString("en-US")} rows`],
  ];

  return (
    <dl className="grid grid-cols-1 gap-x-group gap-y-item sm:grid-cols-2">
      {facts.map(([label, value]) => (
        <div key={label} className="space-y-1 border-l-2 border-ink pl-3">
          <dt className="font-mono text-micro text-graphite">{label}</dt>
          <dd className="font-mono text-small font-medium tabular">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
