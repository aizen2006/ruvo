"use client";

import type { Criterion } from "@repo/contracts";
import { ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export interface RuleEdits {
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}

/** A row's rules: what it must satisfy, and what only makes it rank higher. */
export function RuleChips({ criteria, edits }: { criteria: Criterion[]; edits?: RuleEdits }) {
  const must = criteria.filter((c) => c.strength === "hard");
  const nice = criteria.filter((c) => c.strength === "soft");
  return (
    <div className="grid gap-group">
      <RuleGroup title="Keeps only rows that" empty="No strict rules: every row is kept." items={must} edits={edits} />
      <RuleGroup title="Ranks higher when" empty="No preferences." items={nice} edits={edits} />
    </div>
  );
}

function RuleGroup({ title, empty, items, edits }: { title: string; empty: string; items: Criterion[]; edits?: RuleEdits }) {
  return (
    <div className="space-y-tight">
      <h3 className="font-mono text-micro text-graphite">{title}</h3>
      {items.length === 0 ? (
        <p className="text-small text-pencil">{empty}</p>
      ) : (
        <ul className="flex flex-wrap gap-tight">
          {items.map((c) => (
            <li key={c.id}>{edits ? <EditableRule rule={c} edits={edits} /> : <span className={`${RULE} border border-hairline bg-sheet`}>{c.label}</span>}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

const RULE = "inline-flex items-center gap-1.5 rounded-control px-3 py-1.5 text-left font-mono text-small";

/** An editable rule is a bevel key that opens its menu; it stays pressed in while the menu is open. */
function EditableRule({ rule, edits }: { rule: Criterion; edits: RuleEdits }) {
  const strict = rule.strength === "hard";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={`${RULE} bevel`}>
        {rule.label}
        <ChevronDown className="size-3.5 text-graphite" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => edits.onToggle(rule.id)}>{strict ? "Make it a preference" : "Make it a must"}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => edits.onRemove(rule.id)} className="text-brick">
          Remove this rule
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
