"use client";

import type { DatasetContract, RunDetail, RunEvent } from "@repo/contracts";
import { useState } from "react";
import { ContractView } from "@/components/contract/contract-view";
import { QualityView } from "@/components/quality/quality-view";
import { DecisionsView } from "@/components/run/decisions-view";
import { EventFeed } from "@/components/run/event-feed";
import { TabList, TabPanel, Tabs } from "@/components/ui/tabs";
import { WorkflowView } from "@/components/workflow/workflow-view";
import { formatNumber } from "@/lib/format";

/**
 * The machinery, for people who want it: the compiled contract, the workflow and its recipes,
 * quality charts, how each judgement was made, and the raw activity log.
 */
export function BehindTheScenes({
  run,
  events,
  edited,
  onEdit,
}: {
  run: RunDetail;
  events: RunEvent[];
  edited: DatasetContract | null;
  onEdit: (c: DatasetContract | null) => void;
}) {
  const [tab, setTab] = useState("workflow");
  return (
    <section aria-labelledby="behind" className="space-y-item border-t border-hairline pt-stack">
      <div className="space-y-1">
        <h2 id="behind" className="text-heading font-semibold">
          Behind the scenes
        </h2>
        <p className="text-small text-graphite">How RUVO planned, collected and checked this list.</p>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabList
          tabs={[
            { value: "workflow", label: "Workflow" },
            { value: "contract", label: "Contract" },
            { value: "quality", label: "Quality" },
            { value: "decisions", label: "Decisions" },
            { value: "activity", label: "Activity", hint: events.length ? formatNumber(events.length) : undefined },
          ]}
        />
        <TabPanel value="workflow">
          <WorkflowView run={run} events={events} />
        </TabPanel>
        <TabPanel value="contract">
          <ContractView run={run} edited={edited} onEdit={onEdit} />
        </TabPanel>
        <TabPanel value="quality">
          <QualityView run={run} />
        </TabPanel>
        <TabPanel value="decisions">
          <DecisionsView run={run} />
        </TabPanel>
        <TabPanel value="activity" className="py-4">
          <EventFeed events={events} />
        </TabPanel>
      </Tabs>
    </section>
  );
}
