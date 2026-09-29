"use client";

import { estimateRunCost, MAX_PROMPT_LENGTH, type ModelChoice, type RunMode } from "@repo/contracts";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DotField } from "@/components/dot-field";
import { PageList } from "@/components/page-list";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { api, ApiError } from "@/lib/api";
import { costRange } from "@/lib/plain";
import { useRunOptions } from "@/lib/queries";
import { withPages } from "@/lib/url";
import { Examples, type Example } from "./examples";
import { ModelPicker } from "./model-picker";
import { ModePicker } from "./mode-picker";
import { VoiceButton } from "./voice-button";

/** A random key; crypto.randomUUID only exists on secure origins (https or localhost). */
const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const MIN_PROMPT = 10;

/** Spoken phrases continue the typed request, separated by a space. */
const appendSpoken = (prompt: string, spoken: string) => (prompt && !/\s$/.test(prompt) ? `${prompt} ${spoken}` : `${prompt}${spoken}`);

/** The server's first validation message (e.g. "Describe the data you need…"), else the error itself. */
const errorText = (error: Error) =>
  (error instanceof ApiError && Array.isArray(error.details) && (error.details[0] as { message?: string } | undefined)?.message) || error.message;

/**
 * The ask screen: what list you want, optional pages to read, how thorough, and (advanced)
 * which models. Nothing is collected until the plan is checked, unless the person skips it.
 */
export function AskComposer() {
  const router = useRouter();
  const options = useRunOptions();
  const [prompt, setPrompt] = useState("");
  const [heard, setHeard] = useState("");
  const [urls, setUrls] = useState<string[]>([]);
  const [mode, setMode] = useState<RunMode>("balanced");
  const [models, setModels] = useState<Partial<ModelChoice>>({});
  const [skipCheck, setSkipCheck] = useState(false);

  // One key per exact request: a double submit (click plus Ctrl+Enter, or a retry) creates one dataset.
  const request = { prompt: withPages(prompt, urls), autoStart: skipCheck, mode, models };
  const signature = JSON.stringify(request);
  const [submission, setSubmission] = useState<{ signature: string; key: string } | null>(null);

  const create = useMutation({
    mutationFn: (key: string) => api.createRun(request, key),
    onSuccess: ({ runId }) => router.push(`/runs/${runId}`),
  });
  const tooShort = prompt.trim().length < MIN_PROMPT;
  // Added pages and spoken words count too, so the textarea's maxLength alone isn't enough.
  const tooLong = request.prompt.length > MAX_PROMPT_LENGTH;
  const submit = () => {
    if (tooShort || tooLong || create.isPending) return;
    const key = submission?.signature === signature ? submission.key : newKey();
    setSubmission({ signature, key });
    create.mutate(key);
  };

  const pick = (example: Example) => {
    setPrompt(example.prompt);
    setUrls(example.urls ?? []);
  };

  const selected = options.data?.modes.find((m) => m.id === mode);
  const estimate = selected && options.data ? estimateRunCost({ ...selected.models, ...models }, selected.budgets.maxLlmCalls, options.data.models) : null;

  return (
    // Wide screens: step out of the page's reading column onto the full frame, left aligned, leaving the right side to the field.
    <div className="space-y-section lg:mx-[calc((100%-min(100vw,1200px))/2+1.5rem)]">
      {/* This screen's own field replaces the ambient one, so plain paper covers that. */}
      <div aria-hidden className="fixed inset-0 -z-10 m-0 bg-canvas" />
      {/* The hero field at full strength: a band above the question on small screens, bleeding off the right edge on wide ones. */}
      <DotField
        tone="ink"
        interactive
        className="-mx-4 -mt-stack -mb-group h-48[mask-image:linear-gradient(to_bottom,black_30%,transparent)] sm:mx-0 sm:-mt-section lg:fixed lg:inset-y-0 lg:right-0 lg:-z-10 lg:m-0 lg:h-auto lg:w-1/2 lg:[mask-image:linear-gradient(to_right,transparent,black_30%)]"
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-group lg:max-w-[600px]"
      >
        <label htmlFor="prompt" className="block pb-tight font-dot text-display font-extrabold">
          What do you want a list of?
        </label>

        <div className="frost rounded-panel transition-shadow duration-(--duration-fast) focus-within:[box-shadow:inset_0_0_0_1px_var(--color-ink),0_0_0_4px_var(--color-highlighter-wash),var(--shadow-raised)]">
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            }}
            rows={3}
            maxLength={MAX_PROMPT_LENGTH}
            placeholder="Remote backend jobs at AI companies, with salary"
            className="block w-full resize-none rounded-t-panel bg-transparent px-group pt-group pb-item text-heading placeholder:text-pencil focus:outline-none"
          />
          {heard && <p className="-mt-tight px-group pb-item text-heading text-pencil">{heard}</p>}
          <div className="flex items-start gap-item border-t border-ink/10 px-group py-3">
            <PageList urls={urls} onChange={setUrls} className="min-w-0 flex-1" />
            <VoiceButton onInterim={setHeard} onFinal={(spoken) => setPrompt((p) => appendSpoken(p, spoken))} />
          </div>
        </div>

        {options.isPending ? (
          <div className="grid gap-tight sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-28 rounded-panel" />
            ))}
          </div>
        ) : options.data ? (
          <div className="space-y-tight">
            <ModePicker modes={options.data.modes} catalog={options.data.models} value={mode} models={models} onChange={setMode} />
            {selected && <ModelPicker catalog={options.data.models} defaults={selected.models} value={models} onChange={setModels} />}
          </div>
        ) : (
          <p className="text-small text-graphite">Cost estimates aren&apos;t available right now. RUVO will use the balanced setting.</p>
        )}

        {/* The cost sits next to the button that spends it, wrapping under the switch when the column is narrow. */}
        <div className="flex flex-col gap-item sm:flex-row sm:flex-wrap sm:items-center">
          <label className="flex items-center gap-tight font-mono text-micro text-graphite">
            <Switch checked={skipCheck} onCheckedChange={setSkipCheck} />
            Start without checking the plan
          </label>
          <div className="flex flex-col gap-tight sm:ml-auto sm:flex-row sm:items-center sm:gap-item">
            {estimate && <span className="font-mono text-micro text-graphite tabular">{costRange(estimate.typicalUsd, estimate.highUsd)}</span>}
            <Button type="submit" variant="primary" size="lg" className="w-full sm:w-auto" disabled={tooShort || tooLong || create.isPending}>
              {create.isPending ? "Starting…" : "Make my list"}
            </Button>
          </div>
        </div>
        {(tooLong || create.error) && (
          <p role="alert" className="text-small text-brick">
            {tooLong ? `Keep the request under ${MAX_PROMPT_LENGTH} characters, including added pages.` : errorText(create.error!)}
          </p>
        )}
      </form>

      <Examples onPick={pick} className="lg:max-w-[600px]" />
    </div>
  );
}
