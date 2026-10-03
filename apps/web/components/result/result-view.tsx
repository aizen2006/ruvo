"use client";

import type { RunDetail } from "@repo/contracts";
import { ListPlus, RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { LeadFunnel } from "@/components/run/lead-funnel";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { duration, formatNumber } from "@/lib/format";
import { useRunAction, useWorkflow } from "@/lib/queries";
import { DataTable } from "./data-table";
import { DownloadMenu } from "./download-menu";
import { TrustSummary } from "./trust-summary";
import { WhatChanged } from "./what-changed";

/** A finished list: what it holds and cost, how far to trust it, how it narrowed into leads, what changed, and the rows. */
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
        <div role="status" className={run.status === "failed" ? "rounded-control bg-brick-wash px-group py-item" : "rounded-control bg-ink/6 px-group py-item"}>
          <p className={run.status === "failed" ? "font-medium text-brick" : "font-medium"}>
            {run.status === "failed" ? "This list didn't finish." : "You stopped this list."}
          </p>
          <p className="text-small text-graphite">
            {run.status === "failed"
              ? `${run.error ?? "Something went wrong while collecting."} Rows collected before that are kept below.`
              : "Rows collected before it stopped are kept below."}
          </p>
        </div>
      )}

      {/* The readout: the count and what to do with it, beside how far to trust it. */}
      <div className="grid gap-group border-y border-hairline py-group lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section aria-label="This list" className="space-y-group">
          <div className="space-y-tight">
            <p className="flex items-baseline gap-item">
              <span className="font-dot text-count font-black tabular">{formatNumber(rows)}</span>
              <span className="text-heading text-graphite">{rows === 1 ? "row" : "rows"}</span>
            </p>
            <p className="flex flex-wrap gap-x-item font-mono text-small text-graphite tabular">
              {facts.map((f) => (
                <span key={String(f)}>{f}</span>
              ))}
            </p>
          </div>
          <div className="flex flex-wrap gap-tight">
            {rows > 0 && <DownloadMenu runId={run.id} />}
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
          </div>
          {(rerun.error ?? more.error) && <p className="text-small text-brick">{(rerun.error ?? more.error)!.message}</p>}
        </section>
        {/* Hidden when there is no report yet, so no stray rule is left behind. */}
        <div className="empty:hidden lg:border-l lg:border-hairline lg:pl-group">
          <TrustSummary run={run} />
        </div>
      </div>

      {/* A list that never got a plan has no funnel to show. */}
      {run.funnel.sources > 0 && <LeadFunnel run={run} />}
      <WhatChanged run={run} />
      {run.contract && <DataTable run={run} />}
    </div>
  );
}
