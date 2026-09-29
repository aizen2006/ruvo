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
    <fieldset>
      <legend className="mb-item font-display text-[2rem] leading-none font-black">How thorough?</legend>
      {/* Tiles share their 2px borders, so the three read as one strip of blocks. */}
      <RadioGroup value={value} onValueChange={(v) => onChange(v as RunMode)} className="gap-0 sm:grid-cols-3" aria-label="How thorough">
        {modes.map((mode) => {
          const estimate = estimateRunCost({ ...mode.models, ...models }, mode.budgets.maxLlmCalls, catalog);
          return (
            <RadioTile key={mode.id} value={mode.id} className="-mt-0.5 gap-1 first:mt-0 sm:mt-0 sm:-ml-0.5 sm:first:ml-0">
              <span className="font-display text-[1.75rem] leading-none font-black">{mode.label}</span>
              <span className="text-small text-graphite group-data-[state=checked]:text-ink">{mode.blurb}</span>
              <span className="mt-auto flex w-full flex-wrap items-end justify-between gap-x-item pt-tight tabular">
                <span className="font-display text-[2.5rem] leading-[0.85] font-black">
                  <span className="mr-1 font-sans text-small font-semibold">about</span>
                  {usd(estimate.typicalUsd)}
                </span>
                <span className="text-small font-medium">{minutesPhrase(mode.budgets.maxDurationMs)}</span>
              </span>
            </RadioTile>
          );
        })}
      </RadioGroup>
    </fieldset>
  );
}
