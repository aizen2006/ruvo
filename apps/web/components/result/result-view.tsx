"use client";

import type { RunDetail } from "@repo/contracts";
import { ListPlus, RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { duration, formatNumber } from "@/lib/format";
import { useRunAction, useWorkflow } from "@/lib/queries";
import { DataTable } from "./data-table";
import { DownloadMenu } from "./download-menu";
import { TrustSummary } from "./trust-summary";
import { WhatChanged } from "./what-changed";

/** A finished list: what it holds and cost, how far to trust it, what changed, and the rows. */
export function ResultView({ run }: { run: RunDetail }) {
  const router = useRouter();
  const rerun = useRunAction(run.id, () => api.rerun(run.id));
  const more = useRunAction(run.id, () => api.findMore(run.id));
  // Both start a follow-up run; its page shows progress, then the rows it added.
  const follow = (action: typeof rerun, message: string) => () =>
    action.mutate(undefined, {
      onSuccess: ({ runId }) => {
        toast(message);
        router.push(`/runs/${runId}`);
      },
    });
  const { data: workflow } = useWorkflow(run.id, run.status);
  const rows = run.metrics.validRecords;
  const took = duration(run.startedAt, run.finishedAt);
  const sources = workflow?.ir.sources.length;

  const facts = [
    sources !== undefined && `from ${formatNumber(sources)} ${sources === 1 ? "source" : "sources"}`,
    took && `took ${took}`,
  ].filter(Boolean);

  return (
    <div className="space-y-stack">
      {run.status !== "completed" && (
        <div role="status" className={run.status === "failed" ? "border-l-8 border-brick bg-brick-wash px-group py-item" : "border-l-8 border-ink bg-newsprint px-group py-item"}>
          <p className={run.status === "failed" ? "font-bold text-brick" : "font-bold"}>
            {run.status === "failed" ? "This list didn't finish." : "You stopped this list."}
          </p>
          <p className="text-small text-graphite">
            {run.status === "failed"
              ? `${run.error ?? "Something went wrong while collecting."} Rows collected before that are kept below.`
              : "Rows collected before it stopped are kept below."}
          </p>
        </div>
      )}

      <section className="flex flex-col gap-group bg-highlighter p-group sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-tight">
          <p className="font-display text-mega font-black tabular">
            {formatNumber(rows)} <span className="text-title">{rows === 1 ? "row" : "rows"}</span>
          </p>
          <p className="flex flex-wrap gap-x-item text-small font-semibold tabular">
            {facts.map((f) => (
              <span key={String(f)}>{f}</span>
            ))}
          </p>
        </div>
        <div className="flex flex-wrap gap-tight">
          {run.workflowId && (
            <Button disabled={rerun.isPending} onClick={follow(rerun, "Running again")}>
              <RotateCw /> Run again
            </Button>
          )}
          {/* Finding more searches the web again, so it is offered for lists web search found. */}
          {run.workflowId && workflow?.ir.search && (
            <Button disabled={more.isPending} onClick={follow(more, "Looking for more")}>
              <ListPlus /> Find more
            </Button>
          )}
          {rows > 0 && <DownloadMenu runId={run.id} />}
        </div>
      </section>
      {(rerun.error ?? more.error) && <p className="text-small text-brick">{(rerun.error ?? more.error)!.message}</p>}

      <TrustSummary run={run} />
      <WhatChanged run={run} />
      {run.contract && <DataTable run={run} />}
    </div>
  );
}
