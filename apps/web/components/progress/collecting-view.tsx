"use client";

import type { RunDetail, RunEvent } from "@repo/contracts";
import { DotField } from "@/components/dot-field";
import { LeadFunnel } from "@/components/run/lead-funnel";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { latestFriendly } from "@/lib/friendly-events";
import { useRunAction } from "@/lib/queries";
import { PreviewRows } from "./preview-rows";
import { ProgressTrack, stepOf } from "./progress-track";

/**
 * How settled the field is: a little for each step reached, the rest as rows arrive against the
 * list's row limit, so the noise visibly becomes rows.
 */
function settled(run: RunDetail) {
  const limit = run.contract?.maxRecords ?? 0;
  const rows = limit > 0 ? Math.min(1, run.metrics.rawRecords / limit) : 0;
  return Math.min(1, 0.1 * stepOf(run.status, run.stage) + 0.7 * rows);
}

/**
 * While RUVO gets ready and collects: a black panel whose dot field settles into rows as they
 * arrive, with the live count on top and the steps below; the funnel so far and the first rows sit
 * underneath on paper, and a way to stop.
 */
export function CollectingView({ run, events }: { run: RunDetail; events: RunEvent[] }) {
  const stop = useRunAction(run.id, () => api.cancelRun(run.id));
  const stopping = run.status === "running" && stop.isSuccess;
  const collecting = run.status === "running";
  const line = latestFriendly(events) ?? "Getting ready";
  const { rawRecords, pagesVisited } = run.metrics;

  return (
    <div className="space-y-stack">
      <section className="isolate overflow-hidden rounded-panel bg-void text-sheet">
        <div className="relative">
          {/* The field fades out behind the count: above it on phones, to its left on wider screens. */}
          <DotField
            tone="void"
            resolve={settled(run)}
            interactive
            className="absolute inset-0 -z-10 [mask-image:linear-gradient(black_20%,transparent_45%)] sm:[mask-image:linear-gradient(to_right,transparent_20%,black_65%)]"
          />
          <div className="flex min-h-72 flex-col justify-end gap-group p-group pt-36 sm:flex-row sm:items-end sm:justify-between sm:p-stack">
            <div className="space-y-tight">
              {collecting ? (
                <p className="flex flex-wrap items-baseline gap-x-item">
                  <span className="font-dot text-count font-extrabold tabular">{formatNumber(rawRecords)}</span>
                  <span className="text-heading text-sheet/70">found so far</span>
                </p>
              ) : (
                <p className="font-dot text-title font-extrabold">Getting ready</p>
              )}
              <p className="font-mono text-small text-sheet/70" aria-live="polite">
                {stopping ? "Stopping after the current step…" : line}
                {collecting && pagesVisited > 0 && `. ${formatNumber(pagesVisited)} pages read.`}
              </p>
            </div>
            <Button
              variant="danger"
              className="self-start"
              disabled={stop.isPending || stopping}
              onClick={() => stop.mutate(undefined, { onSuccess: () => toast(collecting ? "Stopping" : "Stopped") })}
            >
              {stopping ? "Stopping…" : "Stop"}
            </Button>
          </div>
        </div>

        <div className="border-t border-sheet/15 px-group py-item sm:px-stack">
          <ProgressTrack status={run.status} stage={run.stage} />
        </div>
      </section>
      {stop.error && <p className="text-small text-brick">{stop.error.message}</p>}

      {collecting && <LeadFunnel run={run} />}
      {collecting && run.contract && <PreviewRows run={run} />}
    </div>
  );
}
