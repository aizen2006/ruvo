"use client";

import Link from "next/link";
import { useRuns } from "@/lib/queries";
import { formatNumber, timeAgo } from "@/lib/format";
import { StatusBadge } from "./status-badge";

/** Past runs as a table; `limit` shows only the most recent ones. */
export function RunHistory({ limit }: { limit?: number }) {
  const { data: runs, isLoading, error } = useRuns();

  if (isLoading) return <p className="py-6 text-sm text-muted">Loading runs…</p>;
  if (error) return <p className="py-6 text-sm text-danger">Can't reach the RUVO API. Check that the server is running on port 3000.</p>;
  if (!runs?.length) return <p className="py-6 text-sm text-muted">No runs yet. Describe the data you need above to start one.</p>;

  const shown = limit ? runs.slice(0, limit) : runs;
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-rule-strong text-left text-muted">
          <th className="py-2 pr-4 font-medium">Request</th>
          <th className="py-2 pr-4 font-medium">Status</th>
          <th className="py-2 pr-4 text-right font-medium">Valid</th>
          <th className="hidden py-2 text-right font-medium sm:table-cell">Started</th>
        </tr>
      </thead>
      <tbody>
        {shown.map((run) => (
          <tr key={run.id} className="border-b border-rule hover:bg-surface">
            <td className="max-w-xl py-3 pr-4 align-top">
              <Link href={`/runs/${run.id}`} className="line-clamp-2 font-serif text-base hover:text-accent sm:line-clamp-1">
                {run.prompt}
              </Link>
            </td>
            <td className="py-3 pr-4">
              <StatusBadge status={run.status} />
            </td>
            <td className="py-3 pr-4 text-right">{run.metrics.validRecords ? formatNumber(run.metrics.validRecords) : "—"}</td>
            <td className="hidden py-3 text-right text-muted sm:table-cell">{timeAgo(run.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
