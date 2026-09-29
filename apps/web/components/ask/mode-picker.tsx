"use client";

import { estimateRunCost, type ModelChoice, type ModeOption, type ModelOption, type RunMode } from "@repo/contracts";
import { RadioGroup, RadioTile } from "@/components/ui/radio-group";
import { minutesPhrase, usd } from "@/lib/plain";

/**
 * How thorough the search is, as three tiles with what each costs and how long it may take.
 * `models` overrides the modes' own models when the person chose them under Advanced.
 */
export function ModePicker({
  modes,
  catalog,
  value,
  models,
  onChange,
}: {
  modes: ModeOption[];
  catalog: ModelOption[];
  value: RunMode;
  models: Partial<ModelChoice>;
  onChange: (mode: RunMode) => void;
}) {
  return (
    <fieldset className="space-y-tight">
      <legend className="mb-tight text-small font-medium">How thorough?</legend>
      <RadioGroup value={value} onValueChange={(v) => onChange(v as RunMode)} className="grid-cols-1 sm:grid-cols-3" aria-label="How thorough">
        {modes.map((mode) => {
          const estimate = estimateRunCost({ ...mode.models, ...models }, mode.budgets.maxLlmCalls, catalog);
          return (
            <RadioTile key={mode.id} value={mode.id} className="gap-1">
              <span className="font-semibold">{mode.label}</span>
              <span className="text-small text-graphite">{mode.blurb}</span>
              <span className="mt-auto flex flex-wrap gap-x-item pt-tight text-small tabular">
                <span className="font-medium">about {usd(estimate.typicalUsd)}</span>
                <span className="text-graphite">{minutesPhrase(mode.budgets.maxDurationMs)}</span>
              </span>
            </RadioTile>
          );
        })}
      </RadioGroup>
    </fieldset>
  );
}
