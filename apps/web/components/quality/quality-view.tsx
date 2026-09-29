"use client";

import type { EvidenceMethod, QualityReport, RunDetail } from "@repo/contracts";
import { formatNumber } from "@/lib/format";
import { useQuality } from "@/lib/queries";
import { methodLabel } from "../method-badge";
import { BarList } from "./bar-list";
import { DiffPanel } from "./diff-panel";

/** Extraction methods grouped by how much they can be trusted, most trustworthy first. */
const TIERS: Array<{ label: string; methods: EvidenceMethod[] }> = [
  { label: "Structured (read directly from source data)", methods: ["API", "JSON_LD", "EMBEDDED_JSON"] },
  { label: "Pattern (read from the page by rules)", methods: ["DOM", "REGEX"] },
  { label: "Model (extracted by AI, quote-verified)", methods: ["LLM"] },
  { label: "Search (read from search-engine results)", methods: ["SEARCH"] },
  { label: "Derived (computed by RUVO)", methods: ["DERIVED"] },
];

const pct = (n: number) => `${Math.round(n * 100)}%`;

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <header>
        <h2 className="text-body font-semibold">{title}</h2>
        {hint && <p className="text-small text-graphite">{hint}</p>}
      </header>
      {children}
    </section>
  );
}

/** Data-quality report for a finished run: how many records survived, how complete and how trustworthy they are. */
export function QualityView({ run }: { run: RunDetail }) {
  const { data: q, isLoading, error } = useQuality(run.id, run.status);

  if (run.status === "failed" || run.status === "cancelled") {
    return (
      <p className="py-group text-graphite">
        This run {run.status === "failed" ? "failed" : "was cancelled"} before its quality report was built. The Activity tab shows what happened;
        Run again to try once more.
      </p>
    );
  }
  if (run.status !== "completed") return <p className="py-group text-graphite">The quality report is ready when the run completes.</p>;
  if (isLoading) return <p className="py-group text-graphite">Loading the quality report…</p>;
  if (error || !q) return <p className="py-group text-brick">{error?.message ?? "No quality report for this run."}</p>;

  const collected = run.metrics.rawRecords;
  const kept = q.totals.valid + q.totals.incomplete;
  const funnel = [
    { label: "Matched the role filter", value: collected, detail: "Postings that passed the keyword filter and were checked" },
    { label: "Kept after checks", value: kept + q.totals.duplicates, detail: "Not rejected by a required criterion" },
    { label: "Unique records", value: kept, detail: `${formatNumber(q.totals.duplicates)} duplicates merged` },
    { label: "Valid records", value: q.totals.valid, detail: `${formatNumber(q.totals.incomplete)} more are missing a required field` },
  ];
  const evidenceTotal = Object.values(q.methodMix).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-section py-group">
      <DiffPanel run={run} />
      <div className="grid gap-12 lg:grid-cols-2">
        <Section title="From postings to dataset" hint="Each step keeps fewer records; hover a bar for detail.">
          <BarList ariaLabel="Record funnel" bars={funnel.map((f) => ({ ...f, display: formatNumber(f.value) }))} labelWidth="11rem" />
        </Section>

        <Section title="How complete each column is" hint="Share of kept records with a value.">
          <BarList
            ariaLabel="Completeness per column"
            max={1}
            labelWidth="9rem"
            bars={q.completeness.map((c) => ({
              label: c.field.replace(/_/g, " "),
              value: c.rate,
              display: pct(c.rate),
              detail: `${formatNumber(c.filled)} of ${formatNumber(c.total)} records`,
            }))}
          />
        </Section>

        <Section
          title="Where the values came from"
          hint={`${formatNumber(evidenceTotal)} values, ${pct(q.verificationRate)} verified against their source.`}
        >
          <div className="space-y-4">
            {TIERS.map((tier) => {
              const bars = tier.methods
                .map((m) => ({ label: methodLabel(m), value: q.methodMix[m] ?? 0 }))
                .filter((b) => b.value > 0)
                .map((b) => ({ ...b, display: formatNumber(b.value), detail: evidenceTotal ? `${pct(b.value / evidenceTotal)} of all values` : undefined }));
              if (bars.length === 0) return null;
              return (
                <div key={tier.label} className="space-y-1.5">
                  <p className="font-mono text-micro text-graphite">{tier.label}</p>
                  <BarList ariaLabel={tier.label} bars={bars} max={Math.max(1, ...Object.values(q.methodMix))} labelWidth="9rem" />
                </div>
              );
            })}
          </div>
        </Section>

        <Section title="How confident RUVO is" hint="Each record's confidence is that of its least certain required value.">
          <BarList
            ariaLabel="Record confidence distribution"
            labelWidth="9rem"
            bars={[...q.confidenceHistogram].reverse().map((b) => ({
              label: b.min === 0 ? "Below 50%" : b.max >= 1 ? `${pct(b.min)} or more` : `${pct(b.min)} to ${pct(b.max)}`,
              value: b.count,
              display: formatNumber(b.count),
            }))}
          />
        </Section>

        {q.rejectReasons.length > 0 && (
          <Section title="Why records were set aside" hint="Rejected and incomplete records, by reason.">
            <BarList
              ariaLabel="Reasons records were set aside"
              tone="neutral"
              labelWidth="16rem"
              bars={q.rejectReasons.map((r) => ({ label: r.reason, value: r.count, display: formatNumber(r.count) }))}
            />
          </Section>
        )}

        <Section title="By source">
          <SourceTable report={q} />
        </Section>
      </div>
    </div>
  );
}

function SourceTable({ report }: { report: QualityReport }) {
  const rows = [...report.bySource].sort((a, b) => b.valid - a.valid);
  return (
    <table className="w-full border-collapse text-small">
      <thead>
        <tr className="border-b-2 border-ink text-left">
          <th className="py-2 pr-4 font-mono text-micro font-normal">Source</th>
          <th className="py-2 pr-4 text-right font-mono text-micro font-normal">Kept</th>
          <th className="py-2 pr-4 text-right font-mono text-micro font-normal">Valid</th>
          <th className="py-2 text-right font-mono text-micro font-normal">Duplicates</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s.sourceId} className="border-b border-hairline">
            <td className="py-2 pr-4">{s.label}</td>
            <td className="py-2 pr-4 text-right tabular-nums">{formatNumber(s.kept)}</td>
            <td className="py-2 pr-4 text-right tabular-nums">{formatNumber(s.valid)}</td>
            <td className="py-2 text-right tabular-nums text-graphite">{formatNumber(s.duplicates)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
