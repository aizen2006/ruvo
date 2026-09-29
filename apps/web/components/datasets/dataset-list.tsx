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
  // A square, like one cell of the dot matrix.
  return <span className={cn("inline-block size-2 shrink-0", DOT[status])} aria-hidden />;
}

/** The list's columns on wide screens: name, status, rows, spent, made, and the run again button. */
const COLUMNS = "gap-x-group px-item sm:items-center sm:grid-cols-[minmax(0,1fr)_11rem_5rem_4.5rem_6.5rem_7.5rem] sm:px-group";

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
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    );
  }
  if (error) return <p className="text-small text-brick">{error.message}</p>;
  if (!runs?.length) {
    return (
      <div className="space-y-item rounded-control border border-dashed border-hairline-strong bg-sheet px-group py-stack text-center">
        <p className="text-graphite">No lists yet. Describe the first one and RUVO will make it.</p>
        <Button variant="primary" asChild>
          <Link href="/new">Make a list</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-item">
      <div className="overflow-hidden rounded-control border border-hairline bg-sheet">
        {/* Column names for wide screens; on phones each row carries its own words. */}
        <div aria-hidden className={cn(COLUMNS, "hidden border-b-2 border-ink py-2.5 font-mono text-micro sm:grid")}>
          <span>Name</span>
          <span>Status</span>
          <span className="text-right">Rows</span>
          <span className="text-right">Spent</span>
          <span className="text-right">Made</span>
        </div>
        <ul className="divide-y divide-hairline">
          {runs.map((run) => (
            <DatasetRow key={run.id} run={run} />
          ))}
        </ul>
      </div>
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
    <li className={cn(COLUMNS, "flex flex-col gap-y-tight py-3 transition-colors hover:bg-canvas/70 sm:grid")}>
      <div className="min-w-0 space-y-0.5">
        <Link href={`/runs/${run.id}`} className="line-clamp-1 font-medium underline-offset-4 hover:underline">
          {/* A run that ended before it was understood has no title; its request names it. */}
          {run.title ?? (isTerminal(run.status) ? run.prompt : "Getting ready")}
        </Link>
        <p className="line-clamp-1 text-small text-pencil" title={run.prompt}>
          {run.prompt}
        </p>
      </div>
      {/* On wide screens the facts join the row's grid as columns. */}
      <dl className="flex flex-wrap items-center gap-x-group gap-y-1 font-mono text-small tabular sm:contents">
        <div className="flex items-center gap-tight">
          <dt className="sr-only">Status</dt>
          <StatusDot status={run.status} />
          <dd>{DATASET_STATUS[run.status]}</dd>
        </div>
        <div className="sm:text-right">
          <dt className="sr-only">Rows</dt>
          <dd>
            {rows ? (
              <>
                {formatNumber(rows)} <span className="text-pencil sm:sr-only">rows</span>
              </>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div className="text-graphite sm:text-right">
          <dt className="sr-only">Spent</dt>
          <dd>{usd(run.costUsd)}</dd>
        </div>
        <div className="text-graphite sm:text-right">
          <dt className="sr-only">Made</dt>
          <dd>{timeAgo(run.createdAt)}</dd>
        </div>
      </dl>
      <div className="-ml-3 empty:hidden sm:ml-0 sm:text-right">
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
