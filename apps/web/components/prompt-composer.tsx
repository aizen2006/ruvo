"use client";

import { useMutation } from "@tanstack/react-query";
import { Switch } from "radix-ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { Button } from "./ui/button";

const EXAMPLES = [
  "Find me backend + AI engineering roles, preferably remote, from good technology companies. Return company, title, location, salary if available, job URL, and why the role matches.",
  "Remote-only ML infrastructure jobs at AI labs, with salary. Max 50.",
  "Senior backend engineering jobs at Stripe and Datadog.",
];

/** A random key; crypto.randomUUID only exists on secure origins (https or localhost). */
const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** The request box: the user's own words, set in the serif RUVO uses for requests everywhere. */
export function PromptComposer() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [skipReview, setSkipReview] = useState(false);

  // One key per request text: a double submit (click plus Ctrl+Enter, or a retry) creates one run.
  const [submission, setSubmission] = useState<{ prompt: string; key: string } | null>(null);

  const create = useMutation({
    mutationFn: (key: string) => api.createRun(prompt.trim(), skipReview, key),
    onSuccess: ({ runId }) => router.push(`/runs/${runId}`),
  });
  const tooShort = prompt.trim().length < 10;
  const submit = () => {
    if (tooShort || create.isPending) return;
    const key = submission?.prompt === prompt.trim() ? submission.key : newKey();
    setSubmission({ prompt: prompt.trim(), key });
    create.mutate(key);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-4"
    >
      <label htmlFor="prompt" className="sr-only">
        Describe the data you need
      </label>
      <textarea
        id="prompt"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
        rows={4}
        placeholder="Backend and AI engineering roles, preferably remote, from good technology companies…"
        className="w-full resize-y rounded-(--radius-control) border border-rule-strong bg-surface px-5 py-4 font-serif text-2xl leading-snug text-ink placeholder:text-faint focus:border-accent focus:outline-none"
      />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Button type="submit" variant="primary" disabled={tooShort || create.isPending}>
          {create.isPending ? "Sending…" : "Compile request"}
        </Button>
        <label className="flex items-center gap-2 text-sm text-muted">
          <Switch.Root
            checked={skipReview}
            onCheckedChange={setSkipReview}
            className="relative h-5 w-9 rounded-full bg-rule-strong transition-colors data-[state=checked]:bg-accent"
          >
            <Switch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white transition-transform data-[state=checked]:translate-x-4.5" />
          </Switch.Root>
          Start collecting without review
        </label>
        {create.error && <p className="text-sm text-danger">{create.error.message}</p>}
      </div>

      <div className="pt-2">
        <p className="mb-2 text-sm text-muted">Or start from an example</p>
        <ul className="space-y-1">
          {EXAMPLES.map((example) => (
            <li key={example}>
              <button
                type="button"
                onClick={() => setPrompt(example)}
                className="text-left font-serif text-base text-muted underline decoration-rule-strong underline-offset-4 hover:text-ink hover:decoration-accent"
              >
                {example}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </form>
  );
}
