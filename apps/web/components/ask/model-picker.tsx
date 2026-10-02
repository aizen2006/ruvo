"use client";

import type { AiAccount, ModelChoice, ModelOption } from "@repo/contracts";
import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Radix Select has no empty value; this one means "whatever the mode uses". */
const MODE_DEFAULT = "mode-default";

const JOBS: Array<{ role: keyof ModelChoice; label: string; hint: string }> = [
  { role: "planner", label: "Understands your request", hint: "Turns your words into a plan. Runs twice per list." },
  { role: "worker", label: "Reads the pages", hint: "Fills gaps and judges unclear rows. Makes most of the AI calls." },
];

const price = (m: ModelOption) => `$${m.inputPerMillion} in, $${m.outputPerMillion} out per million tokens`;

/** Advanced: pick the model for each job. Closed by default; the modes already choose well. */
export function ModelPicker({
  catalog,
  account,
  defaults,
  value,
  onChange,
}: {
  /** The models the AI account can use; a ChatGPT plan's have no price. */
  catalog: ModelOption[];
  account: AiAccount;
  /** The selected mode's own models. */
  defaults: ModelChoice;
  value: Partial<ModelChoice>;
  onChange: (models: Partial<ModelChoice>) => void;
}) {
  const nameOf = (id: string) => catalog.find((m) => m.id === id)?.label ?? id;
  const chosen = Object.values(value).filter(Boolean).length;

  return (
    <Collapsible className="group/models">
      <CollapsibleTrigger className="inline-flex items-center gap-1 rounded-control py-1 font-mono text-micro text-graphite hover:text-ink">
        <ChevronRight className="size-4 transition-transform duration-(--duration-base) group-data-[state=open]/models:rotate-90" />
        Choose models{chosen > 0 && <span className="text-ink"> ({chosen} changed)</span>}
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-item">
        <div className="grid gap-item sm:grid-cols-2">
          {JOBS.map(({ role, label, hint }) => (
            <label key={role} className="space-y-1.5">
              <span className="block font-mono text-micro text-graphite">{label}</span>
              <Select
                value={value[role] ?? MODE_DEFAULT}
                onValueChange={(v) => onChange({ ...value, [role]: v === MODE_DEFAULT ? undefined : v })}
              >
                <SelectTrigger aria-label={label}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={MODE_DEFAULT} hint="Chosen by the mode above">
                    {nameOf(defaults[role])} (default)
                  </SelectItem>
                  {catalog.map((m) => (
                    <SelectItem key={m.id} value={m.id} hint={account === "chatgpt" ? m.blurb : `${m.blurb}. ${price(m)}`}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="block text-micro text-graphite">{hint}</span>
            </label>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
