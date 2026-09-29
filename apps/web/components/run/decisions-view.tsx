"use client";

import type { DecisionSummary, RunDetail } from "@repo/contracts";
import clsx from "clsx";
import { formatNumber } from "@/lib/format";
import { useDecisions } from "@/lib/queries";

type Tier = keyof DecisionSummary["byTier"];

const TIERS: Array<{ tier: Tier; label: string; hint: string; bar: string }> = [
  { tier: "RULES", label: "Rules", hint: "Settled by the contract's own rules, at no cost", bar: "bg-derived" },
  { tier: "DECIDER", label: "Decision model", hint: "Jev answered with enough confidence", bar: "bg-structured" },
  { tier: "LLM", label: "LLM judge", hint: "Uncertain cases the LLM decided", bar: "bg-model" },
  { tier: "DEFAULT", label: "Left undecided", hint: "No budget or no confident answer", bar: "bg-hairline-strong" },
];

const TASK_LABEL: Record<string, string> = {
  CRITERION: "Judging criteria by meaning",
  RELEVANCE: "Triage of free-text posts",
  ROW_VALIDITY: "Checking uncertain records",
  REPAIR_ACTION: "Choosing how to repair a source",
};

/** Which tier made each decision in the run, shown as one proportional bar. */
function TierBar({ byTier, total }: { byTier: DecisionSummary["byTier"]; total: number }) {
  return (
    <div className="flex h-2 overflow-hidden bg-hairline" role="img" aria-label="Decisions by tier">
      {TIERS.map(({ tier, bar }) => (
        <span key={tier} className={bar} style={{ width: `${(byTier[tier] / Math.max(total, 1)) * 100}%` }} />
      ))}
    </div>
  );
}

/** How the run's judgement calls were made: rules, the decision model, the LLM, or not at all. */
export function DecisionsView({ run }: { run: RunDetail }) {
  const { data, isLoading, error } = useDecisions(run.id, run.status);

  if (isLoading) return <p className="py-group text-graphite">Loading decisions…</p>;
  if (error) return <p className="py-group text-brick">{error.message}</p>;
  if (!data || data.total === 0) {
    return <p className="py-group text-graphite">No judgement calls yet. Decisions appear when a criterion needs judging by meaning.</p>;
  }

  const handledByModel = data.byTier.DECIDER;
  const { compared, agreed } = data.agreement;

  return (
    <div className="space-y-section py-group">
      <section className="max-w-3xl space-y-4">
        <p className="max-w-3xl text-body">
          {formatNumber(data.total)} judgement calls. {formatNumber(data.byTier.RULES)} were settled by rules;{" "}
          {data.providerModel ? `the decision model (${data.providerModel})` : "the decision model"} answered{" "}
          {formatNumber(handledByModel)} confidently, so the LLM judged only {formatNumber(data.byTier.LLM)}.
        </p>
        <TierBar byTier={data.byTier} total={data.total} />
        <dl className="grid gap-4 sm:grid-cols-4">
          {TIERS.map(({ tier, label, hint, bar }) => (
            <div key={tier}>
              <dt className="flex items-center gap-2 text-small text-graphite">
                <span className={clsx("size-2", bar)} aria-hidden />
                {label}
              </dt>
              <dd className="text-heading font-medium">{formatNumber(data.byTier[tier])}</dd>
              <dd className="text-micro text-graphite">{hint}</dd>
            </div>
          ))}
        </dl>
        {compared > 0 && (
          <p className="text-small text-graphite">
            The LLM only saw cases the decision model was unsure about. In those hard cases the decision model had leaned the
            same way {agreed} of {compared} times ({Math.round((agreed / compared) * 100)}%).
          </p>
        )}
      </section>

      {data.byTask.length > 1 && (
        <section className="space-y-3">
          <h2 className="text-body font-semibold">By task</h2>
          <ul className="max-w-3xl space-y-3">
            {data.byTask.map((t) => (
              <li key={t.task} className="space-y-1.5">
                <p className="flex justify-between text-small">
                  <span>{TASK_LABEL[t.task] ?? t.task}</span>
                  <span className="text-graphite">{formatNumber(t.total)}</span>
                </p>
                <TierBar byTier={t.byTier} total={t.total} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-body font-semibold">Examples</h2>
        <table className="w-full border-collapse text-small">
          <thead>
            <tr className="border-b-2 border-ink text-left">
              <th className="py-2 pr-4 font-mono text-micro font-normal">Item</th>
              <th className="py-2 pr-4 font-mono text-micro font-normal">Answer</th>
              <th className="py-2 pr-4 font-mono text-micro font-normal">Decided by</th>
              <th className="py-2 font-mono text-micro font-normal">Decision model leaned</th>
            </tr>
          </thead>
          <tbody>
            {data.samples.map((s, i) => (
              <tr key={i} className="border-b border-hairline">
                <td className="max-w-lg py-2 pr-4">
                  <span className="line-clamp-1">{s.subject}</span>
                  {s.question && <span className="line-clamp-1 text-micro text-graphite">{s.question}</span>}
                </td>
                <td className="py-2 pr-4">
                  {s.label} <span className="text-graphite">({Math.round(s.confidence * 100)}%)</span>
                </td>
                <td className="py-2 pr-4">{TIERS.find((t) => t.tier === s.decidedBy)?.label}</td>
                <td className="py-2 text-graphite">{s.shadow ? `${s.shadow.label} (${Math.round(s.shadow.confidence * 100)}%)` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
