"use client";

import { isTerminal, type RunStatus, type RunSummary } from "@repo/contracts";
import { RotateCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { formatNumber, timeAgo } from "@/lib/format";
import { DATASET_STATUS, usd } from "@/lib/plain";
import { useRunAction, useRuns } from "@/lib/queries";
import { cn } from "@/lib/utils";

const PAGE = 50;
/** The most runs the API lists in one request. */
const MAX_RUNS = 200;

const DOT: Record<RunStatus, string> = {
  queued: "bg-pencil",
  compiling: "bg-ink animate-pulse",
  planning: "bg-ink animate-pulse",
  awaiting_approval: "bg-highlighter ring-1 ring-ink/30",
  queued_run: "bg-pencil",
  running: "bg-ink animate-pulse",
  completed: "bg-stamp",
  failed: "bg-brick",
  cancelled: "bg-pencil",
};

export function StatusDot({ status }: { status: RunStatus }) {
  return <span className={cn("inline-block size-2.5 shrink-0 rounded-full", DOT[status])} aria-hidden />;
}

/** Every list the person has made, newest first: open it, or run it again for fresh rows. */
export function DatasetList() {
  const [limit, setLimit] = useState(PAGE);
  const { data: runs, isLoading, isPlaceholderData, error } = useRuns(limit);
  // A full page may have more runs behind it.
  const full = runs?.length === limit;

  if (isLoading) {
    return (
      <div className="space-y-tight">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 rounded-panel" />
        ))}
      </div>
    );
  }
  if (error) return <p className="text-small text-brick">{error.message}</p>;
  if (!runs?.length) {
    return (
      <div className="space-y-item rounded-panel border border-dashed border-hairline-strong px-group py-stack text-center">
        <p className="text-graphite">No lists yet. Describe the first one and RUVO will make it.</p>
        <Button variant="primary" asChild>
          <Link href="/">Make a list</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-item">
      <ul className="divide-y divide-hairline overflow-hidden rounded-panel border border-hairline bg-sheet">
        {runs.map((run) => (
          <DatasetRow key={run.id} run={run} />
        ))}
      </ul>
      {full && limit < MAX_RUNS && (
        <Button disabled={isPlaceholderData} onClick={() => setLimit(limit + PAGE)}>
          Show more
        </Button>
      )}
      {full && limit >= MAX_RUNS && <p className="text-small text-graphite">Showing your latest {MAX_RUNS} lists.</p>}
    </div>
  );
}

function DatasetRow({ run }: { run: RunSummary }) {
  const router = useRouter();
  const rerun = useRunAction(run.id, () => api.rerun(run.id));
  const rows = run.metrics.validRecords;

  return (
    <li className="flex flex-col gap-tight px-group py-item hover:bg-highlighter-wash/40 sm:flex-row sm:items-center sm:gap-group">
      <div className="min-w-0 flex-1 space-y-1">
        <Link href={`/runs/${run.id}`} className="line-clamp-1 font-semibold hover:underline">
          {/* A run that ended before it was understood has no title; its request names it. */}
          {run.title ?? (isTerminal(run.status) ? run.prompt : "Getting ready")}
        </Link>
        <p className="line-clamp-1 text-small text-graphite" title={run.prompt}>
          {run.prompt}
        </p>
      </div>
      <dl className="flex shrink-0 flex-wrap items-center gap-x-group gap-y-1 text-small tabular sm:justify-end">
        <div className="flex items-center gap-tight">
          <dt className="sr-only">Status</dt>
          <StatusDot status={run.status} />
          <dd>{DATASET_STATUS[run.status]}</dd>
        </div>
        <div className="sm:w-20 sm:text-right">
          <dt className="sr-only">Rows</dt>
          <dd>{rows ? `${formatNumber(rows)} rows` : "—"}</dd>
        </div>
        <div className="text-graphite sm:w-20 sm:text-right">
          <dt className="sr-only">Spent</dt>
          <dd>{usd(run.costUsd)}</dd>
        </div>
        <div className="text-graphite sm:w-28 sm:text-right">
          <dt className="sr-only">Made</dt>
          <dd>{timeAgo(run.createdAt)}</dd>
        </div>
      </dl>
      <div className="shrink-0 sm:w-32 sm:text-right">
        {/* Only a run that reached a workflow can be run again. */}
        {isTerminal(run.status) && run.workflowId && (
          <Button
            variant="quiet"
            size="sm"
            disabled={rerun.isPending}
            onClick={() =>
              rerun.mutate(undefined, {
                onSuccess: ({ runId }) => {
                  toast("Running again");
                  router.push(`/runs/${runId}`);
                },
                onError: (err) => toast(err.message),
              })
            }
          >
            <RotateCw /> Run again
          </Button>
        )}
      </div>
    </li>
  );
}
