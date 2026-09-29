"use client";

import { estimateRunCost, type ModelChoice, type RunMode } from "@repo/contracts";
import { useMutation } from "@tanstack/react-query";
import { Globe, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { usd } from "@/lib/plain";
import { useRunOptions } from "@/lib/queries";
import { parseWebAddress, withPages } from "@/lib/url";
import { Examples, type Example } from "./examples";
import { ModelPicker } from "./model-picker";
import { ModePicker } from "./mode-picker";

/** A random key; crypto.randomUUID only exists on secure origins (https or localhost). */
const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const MIN_PROMPT = 10;

/**
 * The ask screen: what list you want, optional pages to read, how thorough, and (advanced)
 * which models. Nothing is collected until the plan is checked, unless the person skips it.
 */
export function AskComposer() {
  const router = useRouter();
  const options = useRunOptions();
  const [prompt, setPrompt] = useState("");
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
  const submit = () => {
    if (tooShort || create.isPending) return;
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
    <div className="space-y-section">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-block"
      >
        <label htmlFor="prompt" className="block text-title font-semibold sm:text-display">
          What do you want a list of?
        </label>

        <div className="rounded-panel border border-hairline-strong bg-sheet transition-colors focus-within:border-ink">
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            }}
            rows={3}
            placeholder="Remote backend jobs at AI companies, with salary"
            className="block w-full resize-none rounded-t-panel bg-transparent px-group pt-group pb-item text-heading placeholder:text-pencil focus:outline-none"
          />
          <PageList urls={urls} onChange={setUrls} />
        </div>

        {options.isPending ? (
          <div className="grid gap-tight sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-28 rounded-panel" />
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

        <div className="flex flex-col gap-item border-t border-hairline pt-group sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-tight text-small text-graphite">
            <Switch checked={skipCheck} onCheckedChange={setSkipCheck} />
            Start without checking the plan
          </label>
          <div className="flex flex-col gap-tight sm:flex-row sm:items-center sm:gap-item">
            {estimate && (
              <span className="text-small text-graphite tabular">
                about {usd(estimate.typicalUsd)}, at most around {usd(estimate.highUsd)}
              </span>
            )}
            <Button type="submit" variant="primary" size="lg" className="w-full sm:w-auto" disabled={tooShort || create.isPending}>
              {create.isPending ? "Starting…" : "Make my list"}
            </Button>
          </div>
        </div>
        {create.error && (
          <p role="alert" className="text-small text-brick">
            {create.error.message}
          </p>
        )}
      </form>

      <Examples onPick={pick} />
    </div>
  );
}

/** Pages the person wants read, plus an inline field to add one. */
function PageList({ urls, onChange }: { urls: string[]; onChange: (urls: string[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const url = parseWebAddress(value);
    if (!url) return setError("Enter a web address, such as example.com/jobs");
    if (!urls.includes(url)) onChange([...urls, url]);
    setValue("");
    setError(null);
    setAdding(false);
  };

  return (
    <div className="space-y-tight border-t border-hairline px-group py-3">
      {urls.length > 0 && (
        <ul className="flex flex-wrap gap-tight">
          {urls.map((url) => (
            <li key={url} className="inline-flex max-w-full items-center gap-1 rounded-full bg-ink/6 py-1 pr-1 pl-3 text-small">
              <Globe className="size-3.5 shrink-0 text-graphite" aria-hidden />
              <span className="truncate">{url.replace(/^https?:\/\//, "")}</span>
              <button
                type="button"
                onClick={() => onChange(urls.filter((u) => u !== url))}
                className="rounded-full p-1 text-graphite hover:bg-ink/10 hover:text-ink"
                aria-label={`Remove ${url}`}
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <div className="space-y-1">
          <div className="flex gap-tight">
            <Input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
                if (e.key === "Escape") setAdding(false);
              }}
              placeholder="example.com/jobs"
              aria-label="Website address"
              aria-invalid={Boolean(error)}
            />
            <Button type="button" onClick={add}>
              Add
            </Button>
          </div>
          {error && <p className="text-micro text-brick">{error}</p>}
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-small text-graphite hover:text-ink">
          <Plus className="size-4" /> Add a website to read from
        </button>
      )}
    </div>
  );
}
