"use client";

import type { RunDetail, RunDiff } from "@repo/contracts";
import Link from "next/link";
import { formatNumber, timeAgo } from "@/lib/format";
import { useDiff } from "@/lib/queries";

/** A field value as short text for the before/after view. */
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "empty" : typeof v === "string" ? v : JSON.stringify(v));

/**
 * What changed since the previous run of the same request: the business case for re-running
 * a workflow instead of rebuilding the dataset by hand.
 */
export function DiffPanel({ run }: { run: RunDetail }) {
  const { data: diff } = useDiff(run.id, run.status);
  if (!diff?.previousRunId) return null;

  const { counts } = diff;
  const stats = [
    { label: "New", value: counts.added },
    { label: "No longer listed", value: counts.removed },
    { label: "Changed", value: counts.changed },
    { label: "Unchanged", value: counts.unchanged },
  ];

  return (
    <section className="space-y-5 border-b border-rule pb-10">
      <header>
        <h2 className="text-lg font-semibold">What changed since the previous run</h2>
        <p className="text-sm text-muted">
          Compared with{" "}
          <Link href={`/runs/${diff.previousRunId}`} className="text-accent underline-offset-2 hover:underline">
            the run {diff.previousFinishedAt ? timeAgo(diff.previousFinishedAt) : "before this one"}
          </Link>
          , matching records by their canonical link.
        </p>
      </header>

      <dl className="flex flex-wrap gap-x-10 gap-y-3">
        {stats.map((s) => (
          <div key={s.label}>
            <dt className="text-xs text-muted">{s.label}</dt>
            <dd className="text-xl tabular-nums">{formatNumber(s.value)}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-8 lg:grid-cols-3">
        <RecordList title="New" items={diff.added} total={counts.added} empty="No new records." />
        <RecordList title="No longer listed" items={diff.removed} total={counts.removed} empty="Nothing disappeared." muted />
        <ChangedList diff={diff} />
      </div>
    </section>
  );
}

function RecordList({ title, items, total, empty, muted }: { title: string; items: RunDiff["added"]; total: number; empty: string; muted?: boolean }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {items.map((r) => (
            <li key={r.key} className={muted ? "text-muted line-through decoration-rule-strong" : undefined}>
              {r.label}
            </li>
          ))}
          {total > items.length && <li className="text-muted">and {formatNumber(total - items.length)} more</li>}
        </ul>
      )}
    </div>
  );
}

function ChangedList({ diff }: { diff: RunDiff }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Changed</h3>
      {diff.changed.length === 0 ? (
        <p className="text-sm text-muted">No values changed.</p>
      ) : (
        <ul className="space-y-3 text-sm">
          {diff.changed.map((r) => (
            <li key={r.key}>
              <p>{r.label}</p>
              {r.fields.map((f) => (
                <p key={f.field} className="text-muted">
                  {f.field.replace(/_/g, " ")}: <span className="line-through decoration-rule-strong">{show(f.before)}</span> → <span className="text-ink">{show(f.after)}</span>
                </p>
              ))}
            </li>
          ))}
          {diff.counts.changed > diff.changed.length && <li className="text-muted">and {formatNumber(diff.counts.changed - diff.changed.length)} more</li>}
        </ul>
      )}
    </div>
  );
}
