"use client";

import type { QualityReport, RunDetail } from "@repo/contracts";
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
 * One sentence on how far the list can be trusted, with a thin bar: values from the sites' own
 * data, values read from pages, and values found by AI with their quote checked.
 */
export function TrustSummary({ run }: { run: RunDetail }) {
  const { data: report } = useQuality(run.id, run.status);
  if (!report) return null;
  const { direct, read, derived, ai, search, total } = trustSplit(report);
  if (total === 0) return null;
  const pct = (n: number) => Math.round((n / total) * 100);

  const segments = [
    { label: "from the sites' own data", n: direct, className: "bg-stamp" },
    { label: "read from the page text", n: read, className: "bg-graphite" },
    { label: "worked out by RUVO", n: derived, className: "bg-pencil" },
    { label: "found by AI, quote checked", n: ai, className: "bg-model" },
    { label: "from search results", n: search, className: "bg-model" },
  ].filter((s) => s.n > 0);

  return (
    <section aria-label="How far to trust this list" className="space-y-tight">
      <p className="text-small">
        <span className="font-medium">{pct(direct)}% of the {formatNumber(total)} values</span>{" "}
        <span className="text-graphite">
          came straight from the sites&apos; own data, and {Math.round(report.verificationRate * 100)}% were checked against the page they came from.
        </span>
      </p>
      <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
        {segments.map((s) => (
          <div key={s.label} className={s.className} style={{ width: `${pct(s.n)}%` }} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-item gap-y-1 text-micro text-graphite">
        {segments.map((s) => (
          <li key={s.label} className="inline-flex items-center gap-1.5">
            <span className={`size-2 rounded-full ${s.className}`} aria-hidden />
            {pct(s.n)}% {s.label}
          </li>
        ))}
      </ul>
    </section>
  );
}
