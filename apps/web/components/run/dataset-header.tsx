"use client";

import type { RunDetail } from "@repo/contracts";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { StatusDot } from "@/components/datasets/dataset-list";
import { Switch } from "@/components/ui/switch";
import { DATASET_STATUS, usd } from "@/lib/plain";

const MODE_LABEL = { quick: "Quick", balanced: "Balanced", thorough: "Thorough" } as const;

/** The dataset's name, the request in the person's words, where it stands, and the details switch. */
export function DatasetHeader({ run, showDetails, onShowDetails }: { run: RunDetail; showDetails: boolean; onShowDetails: (on: boolean) => void }) {
  const title = run.contract?.title ?? "New list";
  return (
    <header className="space-y-item">
      <Link href="/datasets" className="inline-flex items-center gap-1 text-small text-graphite hover:text-ink">
        <ArrowLeft className="size-4" /> Your datasets
      </Link>
      <div className="flex flex-col gap-item sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-tight">
          <h1 className="text-title font-semibold">{title}</h1>
          <p className="line-clamp-2 max-w-3xl text-graphite" title={run.prompt}>
            &ldquo;{run.prompt}&rdquo;
          </p>
          <p className="flex flex-wrap items-center gap-x-item gap-y-1 text-small">
            <span className="inline-flex items-center gap-tight font-medium">
              <StatusDot status={run.status} />
              {DATASET_STATUS[run.status]}
            </span>
            <span className="text-graphite">{MODE_LABEL[run.mode]}</span>
            <span className="text-graphite tabular">{run.costUsd > 0 ? `${usd(run.costUsd)} spent` : "Nothing spent yet"}</span>
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-tight text-small text-graphite">
          <Switch checked={showDetails} onCheckedChange={onShowDetails} />
          Show details
        </label>
      </div>
    </header>
  );
}
