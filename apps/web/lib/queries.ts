"use client";

import { isTerminal, type RunEvent, type RunStatus } from "@repo/contracts";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api, type RecordFilters } from "./api";

/**
 * React Query hooks. A run in progress polls once a second; a run waiting for review polls
 * slowly (only a start from elsewhere changes it); a finished run stops polling.
 */

const POLL_MS = 1000;
const REVIEW_POLL_MS = 5000;
/** The API returns at most this many events per request. */
const EVENTS_PAGE = 500;

const pollInterval = (status: RunStatus | undefined) =>
  status && isTerminal(status) ? false : status === "awaiting_approval" ? REVIEW_POLL_MS : POLL_MS;
/** Part of the query key for data that changes one last time when the run ends. */
const phase = (status: RunStatus | undefined) => ({ finished: Boolean(status && isTerminal(status)) });

export const runKeys = {
  all: ["runs"] as const,
  run: (id: string) => ["runs", id] as const,
  workflow: (id: string) => ["runs", id, "workflow"] as const,
  records: (id: string, filters: RecordFilters) => ["runs", id, "records", filters] as const,
  evidence: (id: string, recordId: string) => ["runs", id, "evidence", recordId] as const,
  quality: (id: string) => ["runs", id, "quality"] as const,
  diff: (id: string) => ["runs", id, "diff"] as const,
  decisions: (id: string) => ["runs", id, "decisions"] as const,
};

export const useRuns = () => useQuery({ queryKey: runKeys.all, queryFn: api.listRuns, refetchInterval: 5_000 });

export function useRun(id: string) {
  return useQuery({
    queryKey: runKeys.run(id),
    queryFn: () => api.getRun(id),
    refetchInterval: (q) => pollInterval(q.state.data?.status),
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
  return useQuery({
    // Refetched once more when the run ends: deduplication happens last.
    queryKey: [...runKeys.records(id, filters), phase(status)],
    queryFn: () => api.listRecords(id, filters),
    placeholderData: keepPreviousData,
    enabled: status === "running" || Boolean(status && isTerminal(status)),
    refetchInterval: status === "running" ? 2_000 : false,
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

/**
 * Accumulates run events by polling `?after=lastSeq`, so each poll only transfers new events.
 * Polls never overlap, a long history is paged through, and a finished run is polled once
 * more shortly after it ends (the worker writes its last event just after the status flips).
 */
export function useRunEvents(id: string, status: RunStatus | undefined) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const lastSeq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        for (;;) {
          const next = await api.listEvents(id, lastSeq.current).catch(() => [] as RunEvent[]);
          if (cancelled || next.length === 0) return;
          lastSeq.current = next.at(-1)!.seq;
          setEvents((prev) => {
            const last = prev.at(-1)?.seq ?? 0;
            return [...prev, ...next.filter((e) => e.seq > last)];
          });
          if (next.length < EVENTS_PAGE) return;
        }
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const interval = pollInterval(status);
    const timer = interval ? setInterval(poll, interval) : setTimeout(poll, 2_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [id, status]);

  return events;
}

/** Wraps a run action and refreshes everything about that run afterwards. */
export function useRunAction<T>(id: string, action: () => Promise<T>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: action,
    onSuccess: () => client.invalidateQueries({ queryKey: runKeys.run(id) }),
  });
}

export const useDecisions = (id: string, status: RunStatus | undefined) =>
  useQuery({
    queryKey: [...runKeys.decisions(id), phase(status)],
    queryFn: () => api.getDecisions(id),
    enabled: status === "running" || Boolean(status && isTerminal(status)),
    refetchInterval: status === "running" ? 3_000 : false,
  });

export const recipeKeys = { all: ["recipes"] as const };

/** Every recorded recipe version; refreshed while a run may be discovering or repairing one. */
export const useRecipes = (status: RunStatus | undefined) =>
  useQuery({ queryKey: recipeKeys.all, queryFn: api.listRecipes, refetchInterval: status === "running" ? 3_000 : false });

export function useSimulateDrift() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ recipeId, mode }: { recipeId: string; mode: "minor" | "major" }) => api.simulateDrift(recipeId, mode),
    onSuccess: () => client.invalidateQueries({ queryKey: recipeKeys.all }),
  });
}

export const useDiff = (id: string, status: RunStatus | undefined) =>
  useQuery({ queryKey: runKeys.diff(id), queryFn: () => api.getDiff(id), enabled: status === "completed" });
