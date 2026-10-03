"use client";

import { VALUE_SETTINGS, type ModelOption, type SecretSetting, type Settings, type SettingsUpdate, type ValueSetting } from "@repo/contracts";
import { useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { ApiError } from "@/lib/api";
import { useSaveSettings, useSettings } from "@/lib/queries";
import { AiAccountSection } from "./ai-account";

const MS_PER_MINUTE = 60_000;
/** Radix Select has no empty value; this one means "the account's default model". */
const ACCOUNT_DEFAULT = "account-default";

type Option = { value: string; label: string; hint: string };

const DECIDERS: Option[] = [
  { value: "jev", label: "Jev", hint: "Hosted by TypeSafe; needs the key above" },
  { value: "laya", label: "Laya", hint: "Self-hosted, at DECIDER_BASE_URL" },
  { value: "off", label: "Off", hint: "Rules and the AI judge decide alone" },
];
const DECIDER_MODES: Option[] = [
  { value: "active", label: "Active", hint: "Acts on its confident answers" },
  { value: "shadow", label: "Shadow", hint: "Asks and logs, but doesn't act" },
  { value: "off", label: "Off", hint: "Never asks" },
];
const PAGE_CACHE: Option[] = [
  { value: "ttl", label: "Reuse recent pages", hint: "Fetches a page again once its stored copy is old" },
  { value: "prefer_cache", label: "Reuse any stored page", hint: "For repeatable demos" },
  { value: "cache_only", label: "Stored pages only", hint: "No network at all" },
  { value: "off", label: "Off", hint: "Always fetches" },
];
const AI_CACHE: Option[] = [
  { value: "on", label: "On", hint: "Identical AI calls are answered from stored answers" },
  { value: "cache_only", label: "Stored answers only", hint: "For offline replays" },
  { value: "off", label: "Off", hint: "Always asks the AI" },
];

/** Settings: what RUVO runs with, kept in apps/server/.env. Production doesn't serve them. */
export function SettingsForm() {
  const settings = useSettings();
  // Keyed by start: once a save restarts RUVO, the form starts over from what it now runs with.
  if (settings.data) return <SettingsFields key={settings.data.startedAt} settings={settings.data} />;
  if (settings.isPending) return <Skeleton className="h-96 max-w-[640px]" />;
  if (settings.error instanceof ApiError && settings.error.status === 404) {
    return (
      <div className="max-w-[640px] space-y-stack">
        <p className="text-graphite">Settings are changed in the server&apos;s .env file, and RUVO reads them when it starts.</p>
        <AiAccountSection />
      </div>
    );
  }
  return (
    <p role="alert" className="text-small text-brick">
      {settings.error.message}
    </p>
  );
}

function SettingsFields({ settings }: { settings: Settings }) {
  const save = useSaveSettings();
  // The time limit is edited in minutes; .env keeps milliseconds.
  const [values, setValues] = useState(() => ({ ...settings.values, MAX_RUN_MS: String(Number(settings.values.MAX_RUN_MS) / MS_PER_MINUTE) }));
  /** Only secrets typed or removed: undefined keeps the saved one, "" removes it. */
  const [secrets, setSecrets] = useState<Partial<Record<SecretSetting, string>>>({});

  // What a save sends: the secrets typed or removed, and the values that differ from what RUVO runs with.
  const changes: SettingsUpdate = Object.fromEntries(Object.entries(secrets).filter(([, v]) => v !== undefined));
  for (const key of VALUE_SETTINGS) {
    const value = key === "MAX_RUN_MS" ? String(Math.round(Number(values.MAX_RUN_MS) * MS_PER_MINUTE)) : values[key];
    if (value !== settings.values[key]) changes[key] = value;
  }

  const set = (key: ValueSetting) => (value: string) => setValues((v) => ({ ...v, [key]: value }));
  const number = (key: ValueSetting, props: InputHTMLAttributes<HTMLInputElement>) => (
    <Input type="number" required value={values[key]} onChange={(e) => set(key)(e.target.value)} {...props} />
  );
  const secret = (name: SecretSetting, label: string, hint: string) => (
    <SecretField name={name} label={label} hint={hint} status={settings.secrets[name]} value={secrets[name]} onChange={(v) => setSecrets((s) => ({ ...s, [name]: v }))} />
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(changes, { onSuccess: () => toast("Saved") });
  };

  return (
    <form onSubmit={submit} className="max-w-[640px] space-y-section">
      <Group title="AI">
        {secret("OPENAI_API_KEY", "OpenAI API key", "When set, RUVO uses this key instead of the ChatGPT sign-in below.")}
        <div className="grid gap-item sm:grid-cols-2">
          <ModelField name="MODEL_PLANNER" label="Understands your request" value={values.MODEL_PLANNER} onChange={set("MODEL_PLANNER")} models={settings.models} fallback={settings.defaultModels.planner} />
          <ModelField name="MODEL_WORKER" label="Reads the pages" value={values.MODEL_WORKER} onChange={set("MODEL_WORKER")} models={settings.models} fallback={settings.defaultModels.worker} />
        </div>
        <AiAccountSection />
      </Group>

      <Group title="Web search">
        <Field name="MAX_SEARCHES" label="Web searches per list, at most">
          {number("MAX_SEARCHES", { min: 0 })}
        </Field>
        {secret("FIRECRAWL_API_KEY", "Firecrawl API key", "Optional: the backup when SearXNG fails or finds nothing, and a last way to read a page. Its credits count in each list's cost.")}
      </Group>

      <Group title="Decision model">
        {secret("TYPESAFE_API_KEY", "TypeSafe API key", "For Jev. Without it, rules and the AI judge decide.")}
        <div className="grid gap-item sm:grid-cols-2">
          <Field name="DECIDER_PROVIDER" label="Decision model">
            <Choice value={values.DECIDER_PROVIDER} onChange={set("DECIDER_PROVIDER")} options={DECIDERS} />
          </Field>
          <Field name="DECIDER_MODE" label="How RUVO uses it">
            <Choice value={values.DECIDER_MODE} onChange={set("DECIDER_MODE")} options={DECIDER_MODES} />
          </Field>
        </div>
      </Group>

      <Group title="Limits" hint="Ceilings for every list: no mode goes above them.">
        <div className="grid gap-item sm:grid-cols-2">
          <Field name="MAX_PAGES" label="Pages per list">
            {number("MAX_PAGES", { min: 1 })}
          </Field>
          <Field name="MAX_BROWSER_PAGES" label="Pages opened in a browser">
            {number("MAX_BROWSER_PAGES", { min: 0 })}
          </Field>
          <Field name="MAX_LLM_CALLS" label="AI calls per list">
            {number("MAX_LLM_CALLS", { min: 0 })}
          </Field>
          <Field name="MAX_RUN_MS" label="Minutes per list">
            {number("MAX_RUN_MS", { min: 1, step: "any" })}
          </Field>
        </div>
        <Field
          name="DAILY_BUDGET_USD"
          label="Daily spending cap, in dollars"
          hint={
            settings.account === "chatgpt"
              ? "Only with an API key: a ChatGPT plan has no AI spend to cap."
              : "Blank: no cap. New lists are refused once the last 24 hours of AI and Firecrawl spend reach it."
          }
        >
          {number("DAILY_BUDGET_USD", { required: false, min: 0.01, step: 0.01 })}
        </Field>
      </Group>

      <Group title="Caching">
        <div className="grid gap-item sm:grid-cols-2">
          <Field name="FETCH_CACHE_MODE" label="Stored pages">
            <Choice value={values.FETCH_CACHE_MODE} onChange={set("FETCH_CACHE_MODE")} options={PAGE_CACHE} />
          </Field>
          <Field name="LLM_CACHE_MODE" label="Stored AI answers">
            <Choice value={values.LLM_CACHE_MODE} onChange={set("LLM_CACHE_MODE")} options={AI_CACHE} />
          </Field>
        </div>
      </Group>

      <div className="space-y-item border-t border-hairline pt-group">
        {/* The restarted worker requeues a run whose heartbeat stopped (after 30 s); one already on its second attempt fails instead. */}
        <p className="text-small text-graphite">
          Saving restarts RUVO, which takes a few seconds. A list being collected then starts over by itself about 30 seconds later,
          reusing the pages and AI answers it already has. A list caught by two restarts stops with an error; run it again.
        </p>
        <Button type="submit" variant="primary" disabled={Object.keys(changes).length === 0 || save.isPending}>
          {save.restarting ? "RUVO is restarting…" : save.isPending ? "Saving…" : "Save"}
        </Button>
        {save.error && (
          <p role="alert" className="text-small whitespace-pre-line text-brick">
            {save.error.message}
          </p>
        )}
      </div>
    </form>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-item">
      <legend className="text-heading font-semibold">{title}</legend>
      {hint && <p className="text-small text-graphite">{hint}</p>}
      {children}
    </fieldset>
  );
}

const labelText = "flex items-baseline justify-between gap-tight font-mono text-micro text-graphite";

/** A setting in plain words, with its name in .env. */
function Field({ name, label, hint, children }: { name: ValueSetting; label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className={labelText}>
        {label} <span className="text-pencil">{name}</span>
      </span>
      {children}
      {hint && <span className="block text-micro text-graphite">{hint}</span>}
    </label>
  );
}

/** A secret is never shown: only whether it is set and how it ends. Typing replaces it; Remove deletes it. */
function SecretField(props: {
  name: SecretSetting;
  label: string;
  hint: string;
  status: Settings["secrets"][SecretSetting];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  const { name, status, value, onChange } = props;
  const removing = value === "";
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className={labelText}>
        {props.label} <span className="text-pencil">{name}</span>
      </label>
      <div className="flex gap-tight">
        <Input
          id={name}
          type="password"
          autoComplete="off"
          spellCheck={false}
          disabled={removing}
          placeholder={status.set ? "Type a new key to replace it" : "Not set"}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
        {status.set && (
          <Button type="button" variant="quiet" onClick={() => onChange(removing ? undefined : "")}>
            {removing ? "Keep it" : "Remove"}
          </Button>
        )}
      </div>
      <p className="text-micro text-graphite">
        {removing ? "Removed when you save. " : status.set ? `Set${status.last4 ? `, ending in ${status.last4}` : ""}. ` : ""}
        {props.hint}
      </p>
    </div>
  );
}

function Choice({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: Option[] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} hint={o.hint}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The account's models; blank is its default. A model .env names that the account doesn't offer still shows, so it can be changed. */
function ModelField(props: { name: ValueSetting; label: string; value: string; onChange: (value: string) => void; models: ModelOption[]; fallback: string }) {
  const { value, models } = props;
  const choices = !value || models.some((m) => m.id === value) ? models : [...models, { id: value, label: value, blurb: "Not offered on this account" }];
  return (
    <Field name={props.name} label={props.label}>
      <Select value={value || ACCOUNT_DEFAULT} onValueChange={(v) => props.onChange(v === ACCOUNT_DEFAULT ? "" : v)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ACCOUNT_DEFAULT} hint="The account's default">
            {models.find((m) => m.id === props.fallback)?.label ?? props.fallback} (default)
          </SelectItem>
          {choices.map((m) => (
            <SelectItem key={m.id} value={m.id} hint={m.blurb}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
