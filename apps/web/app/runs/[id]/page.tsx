"use client";

import type { DatasetContract } from "@repo/contracts";
import { useParams } from "next/navigation";
import { useState } from "react";
import { BehindTheScenes } from "@/components/details/behind-the-scenes";
import { PlanSheet } from "@/components/plan/plan-sheet";
import { CollectingView } from "@/components/progress/collecting-view";
import { ResultView } from "@/components/result/result-view";
import { DatasetHeader } from "@/components/run/dataset-header";
import { PageNotice } from "@/components/ui/notice";
import { phaseOf } from "@/lib/plain";
import { useRun, useRunEvents } from "@/lib/queries";
import { useShowDetails } from "@/lib/use-show-details";
import Loading from "@/app/loading";

export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  // Keyed by id so unsaved plan edits and filters reset when another dataset opens.
  return <RunWorkspace key={id} id={id} />;
}

/**
 * One dataset, whose body follows where it stands: getting ready, checking the plan,
 * collecting, then the list. The technical views sit behind "Show details".
 */
function RunWorkspace({ id }: { id: string }) {
  const { data: run, error, isLoading } = useRun(id);
  const events = useRunEvents(id, run?.status);
  const [edited, setEdited] = useState<DatasetContract | null>(null);
  const [showDetails, setShowDetails] = useShowDetails();

  if (isLoading) return <Loading />;
  // A failed background refresh keeps showing the last good data; only a missing run replaces the page.
  if (!run) return <PageNotice error={error} what="dataset" />;

  const phase = phaseOf(run.status);

  return (
    <div className="space-y-stack">
      <DatasetHeader run={run} showDetails={showDetails} onShowDetails={setShowDetails} />
      {error && <p className="text-small text-amber">Lost contact with RUVO ({error.message}). Showing the last known state.</p>}

      {phase === "plan" && run.contract ? (
        <div className="max-w-[720px]">
          <PlanSheet run={run} edited={edited} onEdit={setEdited} />
        </div>
      ) : phase === "preparing" || phase === "collecting" ? (
        <CollectingView run={run} events={events} />
      ) : (
        <ResultView run={run} />
      )}

      {showDetails && <BehindTheScenes run={run} events={events} edited={edited} onEdit={setEdited} />}
    </div>
  );
}
