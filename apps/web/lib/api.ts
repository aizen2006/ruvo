import type {
  CreateRunResponse,
  DatasetContract,
  DecisionSummary,
  Evidence,
  Page,
  PlanDraft,
  QualityReport,
  Recipe,
  RecordDTO,
  RunDetail,
  RunEvent,
  RunStatus,
  RunSummary,
  WorkflowIR,
} from "@repo/contracts";

/** Typed client for the RUVO API (apps/server). */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const error = (body as { error?: string; details?: unknown } | null) ?? {};
    throw new ApiError(res.status, error.error ?? `Request failed (${res.status})`, error.details);
  }
  return body as T;
}

export interface WorkflowView {
  workflowId: string;
  version: number;
  ir: WorkflowIR;
  planDraft: PlanDraft | null;
  contract: DatasetContract;
  contractVersion: number;
  versions: Array<{ id: string; version: number; plannedBy: WorkflowIR["provenance"]["plannedBy"]; createdAt: string }>;
}

export type RecordFilters = {
  q?: string;
  status?: RecordDTO["status"];
  source?: string;
  remote?: "remote" | "hybrid" | "onsite";
  hasSalary?: boolean;
  minConfidence?: number;
  page?: number;
  pageSize?: number;
};

const query = (params: Record<string, string | number | boolean | undefined>) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "");
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)]))}` : "";
};

export const api = {
  createRun: (prompt: string, autoStart: boolean) =>
    request<CreateRunResponse>("/api/runs", {
      method: "POST",
      body: JSON.stringify({ prompt, autoStart }),
      headers: { "Idempotency-Key": crypto.randomUUID() },
    }),
  listRuns: () => request<RunSummary[]>("/api/runs"),
  getRun: (id: string) => request<RunDetail>(`/api/runs/${id}`),
  startRun: (id: string) => request<{ status: RunStatus }>(`/api/runs/${id}/start`, { method: "POST" }),
  cancelRun: (id: string) => request<{ status: RunStatus }>(`/api/runs/${id}/cancel`, { method: "POST" }),
  rerun: (id: string) => request<CreateRunResponse>(`/api/runs/${id}/rerun`, { method: "POST" }),
  getWorkflow: (id: string) => request<WorkflowView>(`/api/runs/${id}/workflow`),
  editContract: (id: string, contract: DatasetContract) =>
    request<{ version: number }>(`/api/runs/${id}/contract`, { method: "PATCH", body: JSON.stringify({ contract }) }),
  listEvents: (id: string, after: number) => request<RunEvent[]>(`/api/runs/${id}/events?after=${after}`),
  listRecords: (id: string, filters: RecordFilters) => request<Page<RecordDTO>>(`/api/runs/${id}/records${query(filters)}`),
  getEvidence: (id: string, recordId: string) =>
    request<{ record: RecordDTO; evidence: Evidence[] }>(`/api/runs/${id}/evidence/${recordId}`),
  getQuality: (id: string) => request<QualityReport>(`/api/runs/${id}/quality`),
  getDecisions: (id: string) => request<DecisionSummary>(`/api/runs/${id}/decisions`),
  listRecipes: () => request<Recipe[]>("/api/recipes"),
  simulateDrift: (recipeId: string, mode: "minor" | "major") =>
    request<Recipe>(`/api/recipes/${recipeId}/simulate-drift`, { method: "POST", body: JSON.stringify({ mode }) }),
  exportUrl: (id: string, format: "csv" | "json", scope: "valid" | "all") =>
    `${API_URL}/api/datasets/${id}/export${query({ format, scope })}`,
};
