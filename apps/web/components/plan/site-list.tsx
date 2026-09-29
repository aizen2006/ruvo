"use client";

import type { SourceBranch } from "@repo/contracts";
import { useState } from "react";
import { Tooltip } from "@/components/ui/tooltip";

const SHOWN = 10;

/** The sources RUVO will read, with the planner's reason for each on hover. */
export function SiteList({ sources }: { sources: SourceBranch[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? sources : sources.slice(0, SHOWN);
  return (
    <ul className="flex flex-wrap gap-tight" aria-label="Sources">
      {shown.map((s) => (
        <li key={s.id}>
          <Tooltip content={s.reason}>
            <span tabIndex={0} className="inline-flex rounded-full bg-ink/6 px-3 py-1 text-small">
              {s.label}
            </span>
          </Tooltip>
        </li>
      ))}
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
