import type {
  CreateRunRequest,
  CreateRunResponse,
  DatasetContract,
  DecisionSummary,
  Evidence,
  ExportQuery,
  Page,
  PlanDraft,
  QualityReport,
  Recipe,
  RecordDTO,
  RunDetail,
  RunDiff,
  RunEvent,
  RunOptions,
  RunStatus,
  RunSummary,
  WorkflowIR,
} from "@repo/contracts";

/** Typed client for the RUVO API (apps/server). */

// Without the trim, a configured trailing slash turns every request into "//api/...", which matches no route.
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000").replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** A 4xx answer (e.g. not found) won't change if asked again. */
export const isClientError = (error: unknown) => error instanceof ApiError && error.status >= 400 && error.status < 500;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    // Only bodies need a content type; a header-free GET stays a "simple" request with no CORS preflight.
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { ...(init?.body !== undefined && { "content-type": "application/json" }), ...init?.headers },
    });
  } catch {
    throw new ApiError(0, `Can't reach the RUVO API at ${API_URL}. Check that the server is running.`);
  }
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
  /** `idempotencyKey` should stay the same for repeated submissions of one request, so the server creates one run. */
  createRun: (input: CreateRunRequest, idempotencyKey: string) =>
    request<CreateRunResponse>("/api/runs", {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "Idempotency-Key": idempotencyKey },
    }),
  getOptions: () => request<RunOptions>("/api/options"),
  listRuns: (limit: number) => request<RunSummary[]>(`/api/runs?limit=${limit}`),
  getRun: (id: string) => request<RunDetail>(`/api/runs/${id}`),
  startRun: (id: string) => request<{ status: RunStatus }>(`/api/runs/${id}/start`, { method: "POST" }),
  cancelRun: (id: string) => request<{ status: RunStatus }>(`/api/runs/${id}/cancel`, { method: "POST" }),
  rerun: (id: string) => request<CreateRunResponse>(`/api/runs/${id}/rerun`, { method: "POST" }),
  /** A follow-up run that searches for sources not read yet. */
  findMore: (id: string) => request<CreateRunResponse>(`/api/runs/${id}/more`, { method: "POST" }),
  getWorkflow: (id: string) => request<WorkflowView>(`/api/runs/${id}/workflow`),
  /** `removeSources` drops sources web search found (by ref) from the plan. */
  editContract: (id: string, contract: DatasetContract, removeSources: string[] = []) =>
    request<{ version: number }>(`/api/runs/${id}/contract`, { method: "PATCH", body: JSON.stringify({ contract, removeSources }) }),
  listEvents: (id: string, after: number) => request<RunEvent[]>(`/api/runs/${id}/events?after=${after}`),
  listRecords: (id: string, filters: RecordFilters) => request<Page<RecordDTO>>(`/api/runs/${id}/records${query(filters)}`),
  getEvidence: (id: string, recordId: string) =>
    request<{ record: RecordDTO; evidence: Evidence[] }>(`/api/runs/${id}/evidence/${recordId}`),
  getQuality: (id: string) => request<QualityReport>(`/api/runs/${id}/quality`),
  getDiff: (id: string) => request<RunDiff>(`/api/runs/${id}/diff`),
  getDecisions: (id: string) => request<DecisionSummary>(`/api/runs/${id}/decisions`),
  listRecipes: () => request<Recipe[]>("/api/recipes"),
  simulateDrift: (recipeId: string, mode: "minor" | "major") =>
    request<Recipe>(`/api/recipes/${recipeId}/simulate-drift`, { method: "POST", body: JSON.stringify({ mode }) }),
  exportUrl: (id: string, format: ExportQuery["format"], scope: ExportQuery["scope"]) =>
    `${API_URL}/api/datasets/${id}/export${query({ format, scope })}`,
};
