"use client";

import type { RunDetail, RunDiff } from "@repo/contracts";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatNumber, timeAgo } from "@/lib/format";
import { useDiff } from "@/lib/queries";

const SHOWN = 8;

/** On a re-run: one sentence on what is new, gone or different since last time, with the rows on request. */
export function WhatChanged({ run }: { run: RunDetail }) {
  const { data: diff } = useDiff(run.id, run.status);
  if (!diff?.previousRunId) return null;
  const { added, removed, changed } = diff.counts;

  const parts = [added && `${formatNumber(added)} new`, removed && `${formatNumber(removed)} gone`, changed && `${formatNumber(changed)} changed`].filter(Boolean);

  return (
    <Collapsible className="group/diff border-2 border-ink bg-sheet px-group py-item">
      <div className="flex flex-wrap items-center justify-between gap-tight">
        <p className="text-small">
          <span className="font-medium">Since </span>
          <Link href={`/runs/${diff.previousRunId}`} className="font-medium underline underline-offset-2">
            the last run{diff.previousFinishedAt ? `, ${timeAgo(diff.previousFinishedAt)}` : ""}
          </Link>
          <span className="font-medium">: </span>
          {parts.length ? parts.join(", ") : "nothing changed"}.
        </p>
        {parts.length > 0 && (
          <CollapsibleTrigger className="inline-flex items-center gap-1 text-small font-semibold hover:bg-highlighter">
            <ChevronRight className="size-4 transition-transform group-data-[state=open]/diff:rotate-90" />
            See the rows
          </CollapsibleTrigger>
        )}
      </div>
      <CollapsibleContent className="grid gap-group pt-item sm:grid-cols-3">
        <Rows title="New" items={diff.added} total={added} />
        <Rows title="Gone" items={diff.removed} total={removed} gone />
        <Rows title="Changed" items={diff.changed} total={changed} />
      </CollapsibleContent>
    </Collapsible>
  );
}

function Rows({ title, items, total, gone }: { title: string; items: RunDiff["added"]; total: number; gone?: boolean }) {
  if (total === 0) return null;
  return (
    <div className="space-y-1">
      <h3 className="font-display text-heading font-black">{title}</h3>
      <ul className="space-y-1 text-small">
        {items.slice(0, SHOWN).map((r) => (
          <li key={r.key} className={gone ? "text-graphite line-through decoration-hairline-strong" : undefined}>
            {r.label}
          </li>
        ))}
        {total > SHOWN && <li className="text-graphite">and {formatNumber(total - Math.min(SHOWN, items.length))} more</li>}
      </ul>
    </div>
  );
}
