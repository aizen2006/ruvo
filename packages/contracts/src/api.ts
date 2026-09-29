import { z } from "zod";
import { DatasetContract } from "./contract";
import { ModelChoice, RunMode } from "./options";
import { RecordStatus } from "./record";
import { RunMetrics, RunStatus, Stage } from "./run";

/** Request/response shapes shared by the API routes and the dashboard client. */

export const CreateRunRequest = z.object({
  prompt: z.string().trim().min(10, "Describe the data you need in a sentence or two").max(4000),
  autoStart: z.boolean().default(false),
  mode: RunMode.default("balanced"),
  /** Overrides the mode's models (the dashboard's advanced settings). */
  models: ModelChoice.partial().optional(),
});
export type CreateRunRequest = z.infer<typeof CreateRunRequest>;

export const CreateRunResponse = z.object({ runId: z.string(), status: RunStatus });
export type CreateRunResponse = z.infer<typeof CreateRunResponse>;

export const RunSummary = z.object({
  id: z.string(),
  prompt: z.string(),
  status: RunStatus,
  stage: Stage,
  metrics: RunMetrics,
  mode: RunMode,
  models: ModelChoice,
  /** Everything the run spent on AI, including understanding and planning the request. */
  costUsd: z.number(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  error: z.string().nullable(),
});
export type RunSummary = z.infer<typeof RunSummary>;

export const RunDetail = RunSummary.extend({
  contract: DatasetContract.nullable(),
  workflowId: z.string().nullable(),
});
export type RunDetail = z.infer<typeof RunDetail>;

/** Query-string boolean: only "true"/"1" are true (z.coerce.boolean would treat "false" as true). */
const queryBool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

export const ListRecordsQuery = z.object({
  q: z.string().trim().optional(),
  status: RecordStatus.optional(),
  source: z.string().optional(),
  remote: z.enum(["remote", "hybrid", "onsite"]).optional(),
  hasSalary: queryBool.optional(),
  includeDuplicates: queryBool.default(false),
  minConfidence: z.coerce.number().min(0).max(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
});
export type ListRecordsQuery = z.infer<typeof ListRecordsQuery>;

export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };

export const ExportQuery = z.object({
  format: z.enum(["csv", "json"]).default("csv"),
  scope: z.enum(["valid", "all"]).default("valid"),
});
export type ExportQuery = z.infer<typeof ExportQuery>;
