"use client";

import { isTerminal, type RunDetail } from "@repo/contracts";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useRunAction } from "@/lib/queries";
import { StatusBadge } from "../status-badge";
import { Button } from "../ui/button";

/** The request as written, its status, and the actions available right now. */
export function RunHeader({ run }: { run: RunDetail }) {
  const router = useRouter();
  const start = useRunAction(run.id, () => api.startRun(run.id));
  const cancel = useRunAction(run.id, () => api.cancelRun(run.id));
  const rerun = useRunAction(run.id, () => api.rerun(run.id));
  const error = start.error ?? cancel.error ?? rerun.error;

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="max-w-4xl space-y-2">
        <StatusBadge status={run.status} />
        <h1 className="line-clamp-2 font-serif text-xl leading-snug" title={run.prompt}>
          {run.prompt}
        </h1>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {run.status === "awaiting_approval" && (
          <Button variant="primary" onClick={() => start.mutate()} disabled={start.isPending}>
            Start collecting
          </Button>
        )}
        {!isTerminal(run.status) && (
          <Button variant="danger" onClick={() => cancel.mutate()} disabled={cancel.isPending || run.status === "running" && cancel.isSuccess}>
            {run.status === "running" && cancel.isSuccess ? "Stopping…" : "Cancel run"}
          </Button>
        )}
        {isTerminal(run.status) && run.workflowId && (
          <Button onClick={() => rerun.mutate(undefined, { onSuccess: ({ runId }) => router.push(`/runs/${runId}`) })} disabled={rerun.isPending}>
            Run again
          </Button>
        )}
        {error && <p className="w-full text-sm text-danger">{error.message}</p>}
      </div>
    </div>
  );
}
