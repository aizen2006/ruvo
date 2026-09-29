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
      <Link href="/datasets" className="inline-flex items-center gap-1 text-small font-semibold hover:bg-highlighter">
        <ArrowLeft className="size-4" /> Your datasets
      </Link>
      <div className="flex flex-col gap-item sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-item">
          <h1 className="font-display text-display font-black text-balance">{title}</h1>
          <p className="line-clamp-2 max-w-3xl text-heading text-graphite" title={run.prompt}>
            &ldquo;{run.prompt}&rdquo;
          </p>
          {/* Status, mode and spend as cells between ink rules, like a masthead's issue line. */}
          <p className="flex flex-wrap items-center gap-y-1 text-small font-semibold [&>span]:border-l-2 [&>span]:border-ink [&>span]:px-3 [&>span:first-child]:border-l-0 [&>span:first-child]:pl-0">
            <span className="inline-flex items-center gap-tight">
              <StatusDot status={run.status} />
              {DATASET_STATUS[run.status]}
            </span>
            <span>{MODE_LABEL[run.mode]}</span>
            <span className="tabular">{run.costUsd > 0 ? `${usd(run.costUsd)} spent` : "Nothing spent yet"}</span>
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-tight text-small font-semibold">
          <Switch checked={showDetails} onCheckedChange={onShowDetails} />
          Show details
        </label>
      </div>
    </header>
  );
}
