"use client";

import type { RunDetail, RunEvent } from "@repo/contracts";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { latestFriendly } from "@/lib/friendly-events";
import { useRunAction } from "@/lib/queries";
import { PreviewRows } from "./preview-rows";
import { ProgressTrack } from "./progress-track";

/**
 * While RUVO gets ready and collects: where it is, what it is doing in plain words, how much it
 * has found, the first rows as they arrive, and a way to stop.
 */
export function CollectingView({ run, events }: { run: RunDetail; events: RunEvent[] }) {
  const stop = useRunAction(run.id, () => api.cancelRun(run.id));
  const stopping = run.status === "running" && stop.isSuccess;
  const collecting = run.status === "running";
  const line = latestFriendly(events) ?? "Getting ready";
  const { rawRecords, pagesVisited } = run.metrics;

  return (
    <div className="space-y-stack">
      <section className="space-y-stack border-t-[6px] border-ink pt-group">
        <div className="flex flex-col gap-item sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-item">
            {/* The live count is what RUVO has found, so it sits on the highlighter. */}
            {collecting ? (
              <p className="font-display text-mega font-black tabular">
                <span className="inline-block bg-highlighter px-3 pt-2 pb-4">{formatNumber(rawRecords)}</span> <span className="text-title">found so far</span>
              </p>
            ) : (
              <p className="font-display text-display font-black">Getting ready</p>
            )}
            <p className="text-heading" aria-live="polite">
              {stopping ? "Stopping after the current step…" : line}
              {collecting && pagesVisited > 0 && `. ${formatNumber(pagesVisited)} pages read.`}
            </p>
          </div>
          <Button
            variant="danger"
            disabled={stop.isPending || stopping}
            onClick={() => stop.mutate(undefined, { onSuccess: () => toast(collecting ? "Stopping" : "Stopped") })}
          >
            {stopping ? "Stopping…" : "Stop"}
          </Button>
        </div>
        {stop.error && <p className="text-small font-semibold text-brick">{stop.error.message}</p>}
        <ProgressTrack status={run.status} stage={run.stage} />
      </section>

      {collecting && run.contract && <PreviewRows run={run} />}
    </div>
  );
}
