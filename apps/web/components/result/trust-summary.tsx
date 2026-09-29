"use client";

import type { QualityReport, RunDetail } from "@repo/contracts";
import { formatNumber } from "@/lib/format";
import { useQuality } from "@/lib/queries";
import { cn } from "@/lib/utils";

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

const CELLS = 40; // each cell is 2.5% of the values

/** One share as a row of small squares, lit from the left; any share above zero lights at least one. */
function DotBar({ share, signal }: { share: number; signal?: boolean }) {
  const lit = share > 0 ? Math.max(1, Math.round(share * CELLS)) : 0;
  return (
    <span className="grid w-[318px] max-w-full shrink-0 grid-cols-[repeat(40,minmax(0,1fr))] gap-0.5" aria-hidden>
      {Array.from({ length: CELLS }, (_, i) =>
        i < lit ? (
          <span key={i} className={cn("aspect-square", signal ? "bg-highlighter" : "bg-ink")} />
        ) : (
          // Unlit cells are faint pinpoints, so the full length of the bar still reads.
          <span key={i} className="grid aspect-square place-items-center">
            <span className="size-0.5 bg-hairline-strong" />
          </span>
        ),
      )}
    </span>
  );
}

/**
 * One sentence on how far the list can be trusted, then a dot-matrix bar per trust group
 * (filled in ink) and one for the values checked against their page (filled in signal).
 */
export function TrustSummary({ run }: { run: RunDetail }) {
  const { data: report } = useQuality(run.id, run.status);
  if (!report) return null;
  const { direct, read, derived, ai, search, total } = trustSplit(report);
  if (total === 0) return null;
  const pct = (share: number) => `${Math.round(share * 100)}%`;

  const groups = [
    { label: "from the sites' own data", n: direct },
    { label: "read from the page text", n: read },
    { label: "worked out by RUVO", n: derived },
    { label: "found by AI, quote checked", n: ai },
    { label: "from search results", n: search },
  ].filter((g) => g.n > 0);

  return (
    <section aria-label="How far to trust this list" className="space-y-item">
      <p className="max-w-[60ch] text-small text-graphite">
        <span className="font-medium text-ink">{pct(direct / total)} of the {formatNumber(total)} values</span> came straight from the sites&apos; own
        data, and {pct(report.verificationRate)} were checked against the page they came from.
      </p>
      <ul className="space-y-1.5 font-mono text-micro text-graphite tabular">
        {groups.map((g) => (
          <li key={g.label} className="flex flex-wrap items-center gap-x-item gap-y-1">
            <DotBar share={g.n / total} />
            <span>
              <span className="text-ink">{pct(g.n / total)}</span> {g.label}
            </span>
          </li>
        ))}
        <li className="flex flex-wrap items-center gap-x-item gap-y-1 border-t border-hairline pt-1.5">
          <DotBar share={report.verificationRate} signal />
          <span>
            <span className="text-ink">{pct(report.verificationRate)}</span> checked against the page
          </span>
        </li>
      </ul>
    </section>
  );
}
