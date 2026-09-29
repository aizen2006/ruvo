"use client";

import { estimateRunCost, MAX_PROMPT_LENGTH, type ModelChoice, type RunMode } from "@repo/contracts";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
    <div className="grid gap-section lg:grid-cols-12 lg:gap-x-section">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-group lg:col-span-8"
      >
        <label htmlFor="prompt" className="block font-display text-display font-black text-balance">
          What do you want a list of?
        </label>

        <div className="border-[3px] border-ink bg-sheet transition-shadow duration-(--duration-base) focus-within:shadow-[10px_10px_0_-3px_var(--color-highlighter),10px_10px_0_0_var(--color-ink)]">
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
            className="block w-full resize-none rounded-t-panel bg-transparent px-group pt-group pb-item text-[1.5rem] leading-8 font-medium placeholder:text-pencil focus:outline-none"
          />
          {heard && <p className="-mt-tight px-group pb-item text-[1.5rem] leading-8 text-pencil">{heard}</p>}
          <div className="flex items-start gap-item border-t-2 border-ink px-group py-3">
            <PageList urls={urls} onChange={setUrls} className="min-w-0 flex-1" />
            <VoiceButton onInterim={setHeard} onFinal={(spoken) => setPrompt((p) => appendSpoken(p, spoken))} />
          </div>
        </div>

        {options.isPending ? (
          <div className="grid gap-tight sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-40" />
            ))}
          </div>
        ) : options.data ? (
          <div className="space-y-item">
            <ModePicker modes={options.data.modes} catalog={options.data.models} value={mode} models={models} onChange={setMode} />
            {selected && <ModelPicker catalog={options.data.models} defaults={selected.models} value={models} onChange={setModels} />}
          </div>
        ) : (
          <p className="text-small text-graphite">Cost estimates aren&apos;t available right now. RUVO will use the balanced setting.</p>
        )}

        <div className="flex flex-col gap-item border-t-[3px] border-ink pt-item sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-tight text-small font-medium">
            <Switch checked={skipCheck} onCheckedChange={setSkipCheck} />
            Start without checking the plan
          </label>
          <div className="flex flex-col gap-tight sm:flex-row sm:items-center sm:gap-item">
            {estimate && (
              <span className="text-small font-semibold tabular">
                {costRange(estimate.typicalUsd, estimate.highUsd)}
              </span>
            )}
            <Button type="submit" variant="primary" size="lg" className="w-full sm:w-auto" disabled={tooShort || tooLong || create.isPending}>
              {create.isPending ? "Starting…" : "Make my list"}
            </Button>
          </div>
        </div>
        {(tooLong || create.error) && (
          <p role="alert" className="border-l-4 border-brick pl-3 text-small font-semibold text-brick">
            {tooLong ? `Keep the request under ${MAX_PROMPT_LENGTH} characters, including added pages.` : errorText(create.error!)}
          </p>
        )}
      </form>

      <Examples onPick={pick} />
    </div>
  );
}
