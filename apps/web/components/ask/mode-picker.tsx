"use client";

import { estimateRunCost, type AiAccount, type ModelChoice, type ModeOption, type ModelOption, type RunMode } from "@repo/contracts";
import { RadioGroup, RadioTile } from "@/components/ui/radio-group";
import { minutesPhrase, usd } from "@/lib/plain";

/**
 * How thorough the search is, as three tiles with what each costs and how long it may take
 * (on a ChatGPT plan nothing is billed, so only the time).
 * `models` overrides the modes' own models when the person chose them under Advanced.
 */
export function ModePicker({
  modes,
  catalog,
  account,
  value,
  models,
  onChange,
}: {
  modes: ModeOption[];
  catalog: ModelOption[];
  account: AiAccount;
  value: RunMode;
  models: Partial<ModelChoice>;
  onChange: (mode: RunMode) => void;
}) {
  return (
    <fieldset className="space-y-tight">
      <legend className="mb-tight font-mono text-micro text-graphite">How thorough?</legend>
      <RadioGroup value={value} onValueChange={(v) => onChange(v as RunMode)} className="grid-cols-1 sm:grid-cols-3" aria-label="How thorough">
        {modes.map((mode) => {
          const estimate = estimateRunCost({ ...mode.models, ...models }, mode.budgets.maxLlmCalls, catalog);
          return (
            // Text turns full black on the chosen tile, since the signal fill sits behind it.
            <RadioTile key={mode.id} value={mode.id} className="gap-1">
              <span className="font-mono text-small font-semibold">{mode.label}</span>
              <span className="text-small text-graphite group-data-[state=checked]:text-ink">{mode.blurb}</span>
              <span className="mt-auto flex flex-wrap gap-x-item pt-tight font-mono text-micro tabular">
                {account !== "chatgpt" && <span className="font-medium">about {usd(estimate.typicalUsd)}</span>}
                <span className="text-graphite group-data-[state=checked]:text-ink">{minutesPhrase(mode.budgets.maxDurationMs)}</span>
              </span>
            </RadioTile>
          );
        })}
      </RadioGroup>
    </fieldset>
  );
}
