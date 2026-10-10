"use client";

import { isTerminal, type ChatgptSignIn, type RunEvent, type RunStatus, type RunTopic, type SettingsUpdate } from "@repo/contracts";
import { keepPreviousData, useMutation, useQuery, useQueryClient, type InvalidateQueryFilters } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import { api, isClientError, type RecordFilters } from "./api";

/**
 * React Query hooks. An open run page hears from the run's stream what changed (useRunStream) and refetches only
 * that, polling every 15 s in case a change was missed. Without the stream, a run in progress polls once a second,
 * a run waiting for review polls slowly (only a start from elsewhere changes it); a finished run stops polling.
 */

const POLL_MS = 1000;
const REVIEW_POLL_MS = 5000;
/** How often a run page polls while the run's stream is open, in case a change was missed. */
const FALLBACK_MS = 15_000;
/** The API returns at most this many events per request. */
const EVENTS_PAGE = 500;

/** Polls every `ms`, or only as a fallback while the run's stream is open. */
const every = (ms: number, live: boolean) => (live ? FALLBACK_MS : ms);
const pollInterval = (status: RunStatus | undefined, live: boolean) =>
  status && isTerminal(status) ? false : every(status === "awaiting_approval" ? REVIEW_POLL_MS : POLL_MS, live);
/** Part of the query key for data that changes one last time when the run ends. */
const phase = (status: RunStatus | undefined) => ({ finished: Boolean(status && isTerminal(status)) });

export const runKeys = {
  all: ["runs"] as const,
  run: (id: string) => ["runs", id] as const,
  events: (id: string) => ["runs", id, "events"] as const,
  workflow: (id: string) => ["runs", id, "workflow"] as const,
  records: (id: string, filters: RecordFilters) => ["runs", id, "records", filters] as const,
  evidence: (id: string, recordId: string) => ["runs", id, "evidence", recordId] as const,
  quality: (id: string) => ["runs", id, "quality"] as const,
  diff: (id: string) => ["runs", id, "diff"] as const,
  decisions: (id: string) => ["runs", id, "decisions"] as const,
};

/** Runs whose stream is open (see useRunStream); their hooks poll only as a fallback meanwhile. */
const liveRuns = new Set<string>();
const liveListeners = new Set<() => void>();

function setLive(id: string, live: boolean) {
  if (live) liveRuns.add(id);
  else liveRuns.delete(id);
  liveListeners.forEach((listener) => listener());
}

function subscribeLive(listener: () => void) {
  liveListeners.add(listener);
  return () => void liveListeners.delete(listener);
}

/** Whether run `id`'s stream is open. */
const useLive = (id: string) => useSyncExternalStore(subscribeLive, () => liveRuns.has(id), () => false);

/** Modes, models and prices for a new run; they only change when the server restarts. */
export const useRunOptions = () => useQuery({ queryKey: ["options"], queryFn: api.getOptions, staleTime: 5 * 60_000 });

const chatgptKey = ["chatgpt"] as const;

/** The ChatGPT sign-in on the API's machine; polled while a sign-in from Settings is in progress. */
export const useChatgptSignIn = (enabled = true) =>
  useQuery({ queryKey: chatgptKey, queryFn: api.getChatgpt, enabled, refetchInterval: (q) => (q.state.data?.loginUrl ? 2_000 : false) });

/** Signs in or starts the sign-in server; the answer is the new sign-in state. */
export function useChatgptAction(action: () => Promise<ChatgptSignIn>) {
  const client = useQueryClient();
  return useMutation({ mutationFn: action, onSuccess: (status) => client.setQueryData(chatgptKey, status) });
}

const settingsKey = ["settings"] as const;
/** How long Settings waits for RUVO to come back after saving. */
const RESTART_TIMEOUT_MS = 60_000;

/** What RUVO runs with; served only outside production. */
export const useSettings = () => useQuery({ queryKey: settingsKey, queryFn: api.getSettings });

/**
 * Saves settings. RUVO restarts to read them, so `restarting` stays true until the restarted API
 * answers (a new `startedAt`); then the settings, options and sign-in it now uses are loaded again.
 */
export function useSaveSettings() {
  const client = useQueryClient();
  const [restarting, setRestarting] = useState(false);
  const save = useMutation({
    mutationFn: async (changes: SettingsUpdate) => {
      const { startedAt } = await api.saveSettings(changes);
      setRestarting(true);
      try {
        for (const deadline = Date.now() + RESTART_TIMEOUT_MS; Date.now() < deadline; ) {
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          const settings = await api.getSettings().catch(() => null);
          if (settings && settings.startedAt !== startedAt) return settings;
        }
        throw new Error("Saved, but RUVO didn't restart. Started without `bun run dev`, it needs a restart to use the new settings.");
      } finally {
        setRestarting(false);
      }
    },
    onSuccess: (settings) => {
      client.setQueryData(settingsKey, settings);
      // Adding or removing the API key switches the account, and with it the models and the sign-in shown.
      void client.invalidateQueries({ queryKey: ["options"] });
      void client.invalidateQueries({ queryKey: chatgptKey });
    },
  });
  return { ...save, restarting };
}

/** The newest `limit` runs; refreshed while any of them is still in progress. */
export const useRuns = (limit: number) =>
  useQuery({
    queryKey: [...runKeys.all, { limit }],
    queryFn: () => api.listRuns(limit),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (q.state.data?.some((r) => !isTerminal(r.status)) ? 5_000 : false),
  });

export function useRun(id: string) {
  const live = useLive(id);
  return useQuery({
    queryKey: runKeys.run(id),
    queryFn: () => api.getRun(id),
    // A missing run stays missing: stop asking.
    refetchInterval: (q) => (isClientError(q.state.error) ? false : pollInterval(q.state.data?.status, live)),
  });
}

/**
 * The workflow exists once planning is done. It is fetched again when the run finishes,
 * because self-repair during the run moves it onto a new workflow version.
 */
export function useWorkflow(id: string, status: RunStatus | undefined) {
  const planned = status && !["queued", "compiling", "planning"].includes(status);
  return useQuery({
    queryKey: [...runKeys.workflow(id), phase(status)],
    queryFn: () => api.getWorkflow(id),
    placeholderData: keepPreviousData,
    enabled: Boolean(planned),
  });
}

export function useRecords(id: string, filters: RecordFilters, status: RunStatus | undefined) {
  const live = useLive(id);
  return useQuery({
    // Refetched once more when the run ends: deduplication happens last.
    queryKey: [...runKeys.records(id, filters), phase(status)],
    queryFn: () => api.listRecords(id, filters),
    placeholderData: keepPreviousData,
    enabled: status === "running" || Boolean(status && isTerminal(status)),
    refetchInterval: status === "running" && every(2_000, live),
  });
}

export const useEvidence = (id: string, recordId: string | null) =>
  useQuery({
    queryKey: runKeys.evidence(id, recordId ?? ""),
    queryFn: () => api.getEvidence(id, recordId!),
    enabled: Boolean(recordId),
  });

export const useQuality = (id: string, status: RunStatus | undefined) =>
  useQuery({ queryKey: runKeys.quality(id), queryFn: () => api.getQuality(id), enabled: status === "completed" });

const NO_EVENTS: RunEvent[] = [];

/**
 * A run's events, oldest first. Each fetch asks only for events after the newest one held (`?after=seq`), paging
 * through a long history, and React Query never runs two at once. A finished run is asked once more shortly
 * after it ends: the worker writes its last event just after the status flips.
 */
export function useRunEvents(id: string, status: RunStatus | undefined) {
  const client = useQueryClient();
  const live = useLive(id);
  const finished = Boolean(status && isTerminal(status));
  const { data } = useQuery({
    queryKey: runKeys.events(id),
    queryFn: async () => {
      let events = client.getQueryData<RunEvent[]>(runKeys.events(id)) ?? NO_EVENTS;
      for (;;) {
        const next = await api.listEvents(id, events.at(-1)?.seq ?? 0);
        if (next.length) events = [...events, ...next];
        if (next.length < EVENTS_PAGE) return events;
      }
    },
    // Wait for the run itself: one that failed to load has no events.
    enabled: Boolean(status),
    refetchInterval: pollInterval(status, live),
  });

  useEffect(() => {
    if (!finished) return;
    const timer = setTimeout(() => void client.invalidateQueries({ queryKey: runKeys.events(id) }), 2_000);
    return () => clearTimeout(timer);
  }, [client, id, finished]);

  return data ?? NO_EVENTS;
}

/** Wraps a run action and refreshes everything about that run afterwards. */
export function useRunAction<T, V = void>(id: string, action: (variables: V) => Promise<T>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: action,
    onSuccess: () => client.invalidateQueries({ queryKey: runKeys.run(id) }),
  });
}

export function useDecisions(id: string, status: RunStatus | undefined) {
  const live = useLive(id);
  return useQuery({
    queryKey: [...runKeys.decisions(id), phase(status)],
    queryFn: () => api.getDecisions(id),
    enabled: status === "running" || Boolean(status && isTerminal(status)),
    refetchInterval: status === "running" && every(3_000, live),
  });
}

export const recipeKeys = { all: ["recipes"] as const };

/** Every recorded recipe version; refreshed while run `runId` may be discovering or repairing one. */
export function useRecipes(runId: string, status: RunStatus | undefined) {
  const live = useLive(runId);
  return useQuery({ queryKey: recipeKeys.all, queryFn: api.listRecipes, refetchInterval: status === "running" && every(3_000, live) });
}

export function useSimulateDrift() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ recipeId, mode }: { recipeId: string; mode: "minor" | "major" }) => api.simulateDrift(recipeId, mode),
    onSuccess: () => client.invalidateQueries({ queryKey: recipeKeys.all }),
  });
}

export const useDiff = (id: string, status: RunStatus | undefined) =>
  useQuery({ queryKey: runKeys.diff(id), queryFn: () => api.getDiff(id), enabled: status === "completed" });

/** What a run page refetches for each topic its stream names. */
const TOPIC_QUERIES: Record<RunTopic, (id: string) => InvalidateQueryFilters> = {
  run: (id) => ({ queryKey: runKeys.run(id), exact: true }),
  events: (id) => ({ queryKey: runKeys.events(id) }),
  records: (id) => ({ queryKey: ["runs", id, "records"] }),
  decisions: (id) => ({ queryKey: runKeys.decisions(id) }),
  recipes: () => ({ queryKey: recipeKeys.all }),
};

/**
 * Keeps an unfinished run's page current: the run's stream (GET /api/runs/:id/stream) names what changed and only that
 * is refetched, while the hooks above poll every 15 s in case a change was missed. Until the stream opens, and
 * whenever it drops, they poll at their usual rates.
 */
export function useRunStream(id: string, status: RunStatus | undefined) {
  const client = useQueryClient();
  const watching = Boolean(status && !isTerminal(status));

  useEffect(() => {
    if (!watching) return;
    let stream: EventSource;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      stream = new EventSource(`/api/runs/${id}/stream`);
      stream.onopen = () => setLive(id, true);
      stream.onerror = () => {
        setLive(id, false);
        // The browser reconnects by itself when a stream drops, but not after an error answer (the API was down, say).
        if (stream.readyState === EventSource.CLOSED) retry = setTimeout(open, FALLBACK_MS);
      };
      stream.onmessage = (message) => {
        const { topics } = JSON.parse(message.data) as { topics: RunTopic[] };
        for (const topic of topics) void client.invalidateQueries(TOPIC_QUERIES[topic](id));
      };
    };
    open();
    return () => {
      clearTimeout(retry);
      stream.close();
      setLive(id, false);
    };
  }, [client, id, watching]);
}
