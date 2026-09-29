"use client";

import type { SourceBranch } from "@repo/contracts";
import { Search, X } from "lucide-react";
import { useState } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const SHOWN = 10;

/**
 * The sources RUVO will read, with the planner's reason for each on hover. Sources web search
 * found (`found`) are marked, and can be removed when `onRemove` is given.
 */
export function SiteList({
  sources,
  found,
  onRemove,
}: {
  sources: SourceBranch[];
  found?: ReadonlySet<string>;
  onRemove?: (ref: string) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? sources : sources.slice(0, SHOWN);
  return (
    <ul className="flex flex-wrap gap-tight" aria-label="Sources">
      {shown.map((s) => {
        const searched = found?.has(s.ref) ?? false;
        const removable = searched && onRemove;
        return (
          <li key={s.id} className={cn("inline-flex max-w-full items-center gap-1 rounded-full bg-ink/6 py-1 pl-3 text-small", removable ? "pr-1" : "pr-3")}>
            {searched && <Search className="size-3.5 shrink-0 text-graphite" aria-label="Found by web search" />}
            <Tooltip content={s.reason}>
              <span tabIndex={0} className="truncate">
                {s.label}
              </span>
            </Tooltip>
            {removable && (
              <button
                type="button"
                onClick={() => onRemove(s.ref)}
                className="rounded-full p-1 text-graphite hover:bg-ink/10 hover:text-ink"
                aria-label={`Remove ${s.label}`}
              >
                <X className="size-3.5" />
              </button>
            )}
          </li>
        );
      })}
      {sources.length > shown.length && (
        <li>
          <button type="button" onClick={() => setAll(true)} className="px-2 py-1 text-small text-graphite underline underline-offset-4 hover:text-ink">
            and {sources.length - shown.length} more
          </button>
        </li>
      )}
    </ul>
  );
}
