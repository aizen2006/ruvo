"use client";

import { isTerminal } from "@repo/contracts";
import { useParams } from "next/navigation";
import { useState } from "react";
import { EventFeed, LatestEvent } from "@/components/run/event-feed";
import { MetricsLine } from "@/components/run/metrics-line";
import { RunHeader } from "@/components/run/run-header";
import { StageTimeline } from "@/components/run/stage-timeline";
import { TabList, TabPanel, Tabs } from "@/components/ui/tabs";
import { formatNumber } from "@/lib/format";
import { useRun, useRunEvents } from "@/lib/queries";

export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  const { data: run, error, isLoading } = useRun(id);
  const events = useRunEvents(id, run?.status);
  const [tab, setTab] = useState<string | null>(null);

  if (isLoading) return <p className="text-muted">Loading run…</p>;
  if (error || !run) return <p className="text-danger">{error?.message ?? "Run not found"}</p>;

  // Open where the user can act: the contract while reviewing, the dataset once records exist.
  const defaultTab = run.status === "awaiting_approval" || !run.contract ? "contract" : "dataset";
  const recordCount = run.metrics.validRecords + run.metrics.incompleteRecords;

  return (
    <div className="space-y-6">
      <RunHeader run={run} />
      <div className="space-y-3">
        <StageTimeline run={run} />
        <LatestEvent events={events} active={!isTerminal(run.status)} />
        {run.status === "failed" && run.error && <p className="text-sm text-danger">This run failed: {run.error}</p>}
      </div>
      <MetricsLine run={run} />

      <Tabs value={tab ?? defaultTab} onValueChange={setTab}>
        <TabList
          tabs={[
            { value: "contract", label: "Contract" },
            { value: "workflow", label: "Workflow" },
            { value: "dataset", label: "Dataset", hint: recordCount ? formatNumber(recordCount) : undefined },
            { value: "quality", label: "Quality" },
            { value: "activity", label: "Activity", hint: events.length ? formatNumber(events.length) : undefined },
          ]}
        />
        <TabPanel value="contract" className="py-6 text-muted">
          The dataset contract appears here.
        </TabPanel>
        <TabPanel value="workflow" className="py-6 text-muted">
          The workflow appears here.
        </TabPanel>
        <TabPanel value="dataset" className="py-6 text-muted">
          Records appear here.
        </TabPanel>
        <TabPanel value="quality" className="py-6 text-muted">
          The quality report appears here.
        </TabPanel>
        <TabPanel value="activity" className="py-4">
          <EventFeed events={events} />
        </TabPanel>
      </Tabs>
    </div>
  );
}
