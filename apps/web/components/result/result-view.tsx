"use client";

import type { RunDetail } from "@repo/contracts";
import { RotateCw } from "lucide-react";
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
        <div role="status" className={run.status === "failed" ? "rounded-panel bg-brick-wash px-group py-item" : "rounded-panel bg-ink/6 px-group py-item"}>
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

      <section className="flex flex-col gap-item sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <p className="text-display font-semibold tabular">
            {formatNumber(rows)} <span className="text-heading font-medium text-graphite">{rows === 1 ? "row" : "rows"}</span>
          </p>
          <p className="flex flex-wrap gap-x-item text-small text-graphite tabular">
            {facts.map((f) => (
              <span key={String(f)}>{f}</span>
            ))}
          </p>
        </div>
        <div className="flex flex-wrap gap-tight">
          {run.workflowId && (
            <Button
              disabled={rerun.isPending}
              onClick={() =>
                rerun.mutate(undefined, {
                  onSuccess: ({ runId }) => {
                    toast("Running again");
                    router.push(`/runs/${runId}`);
                  },
                })
              }
            >
              <RotateCw /> Run again
            </Button>
          )}
          {rows > 0 && <DownloadMenu runId={run.id} />}
        </div>
      </section>
      {rerun.error && <p className="text-small text-brick">{rerun.error.message}</p>}

      <TrustSummary run={run} />
      <WhatChanged run={run} />
      {run.contract && <DataTable run={run} />}
    </div>
  );
}
