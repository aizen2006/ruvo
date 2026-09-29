"use client";

import type { Criterion } from "@repo/contracts";
import { useState } from "react";

/** How a criterion is checked, in plain words. */
function describe(c: Criterion): string {
  const fields = c.fields.join(", ");
  switch (c.kind) {
    case "keyword_any":
      return `${fields} mentions any of`;
    case "keyword_none":
      return `${fields} mentions none of`;
    case "equals":
      return `${fields} is`;
    case "regex":
      return `${fields} matches the pattern`;
    case "company_tag":
      return "Company is tagged";
    case "semantic":
      return "Judged by meaning";
  }
}

function Values({ criterion }: { criterion: Criterion }) {
  const [open, setOpen] = useState(false);
  if (criterion.kind === "semantic") return <p className="italic">{criterion.values[0]}</p>;
  const shown = open ? criterion.values : criterion.values.slice(0, 10);
  return (
    <p className="flex flex-wrap gap-1.5">
      {shown.map((v) => (
        <span key={v} className="rounded-full border border-hairline bg-sheet px-2 py-0.5 font-mono text-micro">
          {v.replace(/_/g, " ")}
        </span>
      ))}
      {criterion.values.length > shown.length && (
        <button type="button" onClick={() => setOpen(true)} className="text-micro text-ink hover:underline">
          {criterion.values.length - shown.length} more
        </button>
      )}
    </p>
  );
}

export interface CriteriaEdits {
  onToggleStrength?: (id: string) => void;
  onRemove?: (id: string) => void;
}

/** Criteria split into what a record must satisfy and what only raises its score. */
export function CriteriaList({ criteria, edits }: { criteria: Criterion[]; edits?: CriteriaEdits }) {
  const groups = [
    { title: "Must match", hint: "A record failing any of these is rejected.", items: criteria.filter((c) => c.strength === "hard") },
    { title: "Preferences", hint: "These only raise a record's match score.", items: criteria.filter((c) => c.strength === "soft") },
  ];

  return (
    <div className="grid gap-stack md:grid-cols-2">
      {groups.map((group) => (
        <section key={group.title} className="space-y-3">
          <header>
            <h3 className="font-mono text-small font-medium">{group.title}</h3>
            <p className="text-small text-graphite">{group.hint}</p>
          </header>
          {group.items.length === 0 && <p className="text-small text-pencil">None</p>}
          <ul className={group.items.length ? "divide-y divide-hairline border-y border-hairline" : "hidden"}>
            {group.items.map((c) => (
              <li key={c.id} className="space-y-2 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-medium">{c.label}</p>
                  <div className="flex shrink-0 gap-3 text-micro">
                    {c.strength === "soft" && <span className="text-graphite">weight {c.weight.toFixed(1)}</span>}
                    {edits?.onToggleStrength && (
                      <button type="button" onClick={() => edits.onToggleStrength!(c.id)} className="text-ink hover:underline">
                        {c.strength === "hard" ? "Make optional" : "Make required"}
                      </button>
                    )}
                    {edits?.onRemove && (
                      <button type="button" onClick={() => edits.onRemove!(c.id)} className="text-brick hover:underline">
                        Remove
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-small text-graphite">{describe(c)}</p>
                <Values criterion={c} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
