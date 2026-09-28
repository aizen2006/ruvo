"use client";

import { isTerminal, type RunEvent, type RunStatus } from "@repo/contracts";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api, type RecordFilters } from "./api";

/** React Query hooks. Anything tied to an unfinished run polls once a second. */

const POLL_MS = 1000;
const pollWhileActive = (status: RunStatus | undefined) => (status && isTerminal(status) ? false : POLL_MS);

export const runKeys = {
  all: ["runs"] as const,
  run: (id: string) => ["runs", id] as const,
  workflow: (id: string) => ["runs", id, "workflow"] as const,
  records: (id: string, filters: RecordFilters) => ["runs", id, "records", filters] as const,
  evidence: (id: string, recordId: string) => ["runs", id, "evidence", recordId] as const,
  quality: (id: string) => ["runs", id, "quality"] as const,
  decisions: (id: string) => ["runs", id, "decisions"] as const,
};

export const useRuns = () => useQuery({ queryKey: runKeys.all, queryFn: api.listRuns, refetchInterval: 5_000 });

export function useRun(id: string) {
  return useQuery({
    queryKey: runKeys.run(id),
    queryFn: () => api.getRun(id),
    refetchInterval: (q) => pollWhileActive(q.state.data?.status),
  });
}

/**
 * The workflow exists once planning is done. It is fetched again when the run finishes,
 * because self-repair during the run moves it onto a new workflow version.
 */
export function useWorkflow(id: string, status: RunStatus | undefined) {
  const planned = status && !["queued", "compiling", "planning"].includes(status);
  const finished = Boolean(status && isTerminal(status));
  return useQuery({
    queryKey: [...runKeys.workflow(id), { finished }],
    queryFn: () => api.getWorkflow(id),
    enabled: Boolean(planned),
  });
}

export function useRecords(id: string, filters: RecordFilters, status: RunStatus | undefined) {
  return useQuery({
    queryKey: runKeys.records(id, filters),
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
 */
export function useRunEvents(id: string, status: RunStatus | undefined) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const lastSeq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const next = await api.listEvents(id, lastSeq.current).catch(() => []);
      if (cancelled || next.length === 0) return;
      lastSeq.current = next.at(-1)!.seq;
      setEvents((prev) => [...prev, ...next]);
    };
    void poll();
    if (status && isTerminal(status)) return () => void (cancelled = true);
    const timer = setInterval(poll, POLL_MS);
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
    queryKey: runKeys.decisions(id),
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
