"use client";

import type { QualityReport, RunDetail } from "@repo/contracts";
import type { ReactNode } from "react";
import { formatNumber } from "@/lib/format";
import { useQuality } from "@/lib/queries";

/** Where a list's values came from, in four trust groups (see the design system's "Words"). */
function trustSplit(report: QualityReport) {
  // Reports saved before a method existed lack its key; count those as zero.
  const n = (method: keyof QualityReport["methodMix"]) => report.methodMix[method] ?? 0;
  const direct = n("API") + n("JSON_LD") + n("EMBEDDED_JSON");
  const read = n("DOM") + n("REGEX");
  const derived = n("DERIVED");
  const ai = n("LLM");
  const search = n("SEARCH");
  return { direct, read, derived, ai, search, total: direct + read + derived + ai + search };
}

/**
 * How far the list can be trusted, as two big figures with bars: where the values came from
 * (the sites' own data, the page text, RUVO, AI) and how many were checked against their page.
 */
export function TrustSummary({ run }: { run: RunDetail }) {
  const { data: report } = useQuality(run.id, run.status);
  if (!report) return null;
  const { direct, read, derived, ai, search, total } = trustSplit(report);
  if (total === 0) return null;
  const pct = (n: number) => Math.round((n / total) * 100);
  const checked = Math.round(report.verificationRate * 100);

  const segments = [
    { label: "from the sites' own data", n: direct, className: "bg-ink" },
    { label: "read from the page text", n: read, className: "bg-graphite" },
    { label: "worked out by RUVO", n: derived, className: "bg-newsprint" },
    { label: "found by AI, quote checked", n: ai, className: "bg-model" },
    { label: "from search results", n: search, className: "bg-model" },
  ].filter((s) => s.n > 0);

  return (
    <section aria-label="How far to trust this list" className="grid gap-x-section gap-y-group sm:grid-cols-2">
      <Stat figure={pct(direct)} text={<>of the {formatNumber(total)} values came straight from the sites&apos; own data.</>}>
        <div className="flex h-5 border-2 border-ink" aria-hidden>
          {segments.map((s) => (
            <div key={s.label} className={`${s.className} border-r-2 border-sheet last:border-r-0`} style={{ width: `${pct(s.n)}%` }} />
          ))}
        </div>
        <ul className="flex flex-wrap gap-x-item gap-y-1 text-micro font-medium">
          {segments.map((s) => (
            <li key={s.label} className="inline-flex items-center gap-1.5">
              <span className={`size-3 border border-ink ${s.className}`} aria-hidden />
              {pct(s.n)}% {s.label}
            </li>
          ))}
        </ul>
      </Stat>
      {/* Checked against the page is proof, so its bar is the highlighter. */}
      <Stat figure={checked} text="were checked against the page they came from.">
        <div className="h-5 border-2 border-ink" aria-hidden>
          <div className="h-full bg-highlighter" style={{ width: `${checked}%` }} />
        </div>
      </Stat>
    </section>
  );
}

/** A big set percentage with its sentence, over a bar. */
function Stat({ figure, text, children }: { figure: number; text: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-tight border-t-[3px] border-ink pt-item">
      <p className="flex items-end gap-item">
        <span className="font-display text-[4.5rem] leading-[0.8] font-black tabular">{figure}%</span>
        <span className="max-w-64 text-small font-medium">{text}</span>
      </p>
      {children}
    </div>
  );
}
