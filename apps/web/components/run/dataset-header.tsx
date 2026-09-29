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
    <header className="space-y-group">
      <Link href="/datasets" className="inline-flex items-center gap-1 font-mono text-small text-graphite hover:text-ink">
        <ArrowLeft className="size-4" /> Your datasets
      </Link>
      <div className="flex flex-col gap-item sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-item">
          <h1 className="font-dot text-title font-black text-balance">{title}</h1>
          <p className="line-clamp-2 max-w-[68ch] text-graphite" title={run.prompt}>
            &ldquo;{run.prompt}&rdquo;
          </p>
          <p className="flex flex-wrap items-center gap-x-group gap-y-1 font-mono text-small">
            <span className="inline-flex items-center gap-tight">
              <StatusDot status={run.status} />
              {DATASET_STATUS[run.status]}
            </span>
            <span className="text-graphite">{MODE_LABEL[run.mode]}</span>
            <span className="text-graphite tabular">{run.costUsd > 0 ? `${usd(run.costUsd)} spent` : "Nothing spent yet"}</span>
          </p>
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-tight font-mono text-small text-graphite sm:pt-2">
          <Switch checked={showDetails} onCheckedChange={onShowDetails} />
          Show details
        </label>
      </div>
    </header>
  );
}
