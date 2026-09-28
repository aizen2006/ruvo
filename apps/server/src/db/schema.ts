import type {
  DatasetContract,
  Evidence,
  PlanDraft,
  QualityReport,
  Recipe,
  RunDiff,
  RunMetrics,
  RunStatus,
  Signal,
  Stage,
  WorkflowIR,
} from "@repo/contracts";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Postgres is RUVO's single source of truth: requests, contracts, workflow versions,
 * runs (which double as the job queue), events, page snapshots, records and evidence.
 * Enum-like columns are plain text typed via $type to keep schema changes cheap.
 */

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const requests = pgTable("requests", {
  id: id(),
  prompt: text("prompt").notNull(),
  /** Client-supplied Idempotency-Key; a retried POST returns the original run. */
  idempotencyKey: text("idempotency_key").unique(),
  createdAt: createdAt(),
});

export const datasetContracts = pgTable("dataset_contracts", {
  id: id(),
  requestId: uuid("request_id").notNull().references(() => requests.id),
  version: integer("version").notNull(),
  contract: jsonb("contract").$type<DatasetContract>().notNull(),
  model: text("model"),
  editedBy: text("edited_by").$type<"llm" | "user" | "template">().notNull(),
  createdAt: createdAt(),
});

export const workflows = pgTable("workflows", {
  id: id(),
  contractId: uuid("contract_id").notNull().references(() => datasetContracts.id),
  version: integer("version").notNull(),
  parentWorkflowId: uuid("parent_workflow_id"),
  reusedFromWorkflowId: uuid("reused_from_workflow_id"),
  planDraft: jsonb("plan_draft").$type<PlanDraft>(),
  ir: jsonb("ir").$type<WorkflowIR>().notNull(),
  createdAt: createdAt(),
});

/** One row per run. Workers claim `queued_run` rows with FOR UPDATE SKIP LOCKED. */
export const runs = pgTable(
  "runs",
  {
    id: id(),
    requestId: uuid("request_id").notNull().references(() => requests.id),
    workflowId: uuid("workflow_id").references(() => workflows.id),
    status: text("status").$type<RunStatus>().notNull(),
    stage: text("stage").$type<Stage>().notNull(),
    autoStart: boolean("auto_start").notNull().default(false),
    attempt: integer("attempt").notNull().default(0),
    workerId: text("worker_id"),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    metrics: jsonb("metrics").$type<RunMetrics>().notNull(),
    qualityReport: jsonb("quality_report").$type<QualityReport>(),
    diff: jsonb("diff").$type<RunDiff>(),
    error: text("error"),
    createdAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("runs_status_created_idx").on(t.status, t.createdAt)],
);

export const runEvents = pgTable(
  "run_events",
  {
    runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    stage: text("stage").$type<Stage>().notNull(),
    type: text("type").notNull(),
    level: text("level").$type<"info" | "warn" | "error">().notNull(),
    sourceId: text("source_id"),
    message: text("message").notNull(),
    data: jsonb("data"),
  },
  (t) => [primaryKey({ columns: [t.runId, t.seq] })],
);

/** Fetched pages: the HTTP/browser cache and the snapshots evidence points at. */
export const pages = pgTable(
  "pages",
  {
    id: id(),
    url: text("url").notNull(),
    finalUrl: text("final_url").notNull(),
    host: text("host").notNull(),
    via: text("via").$type<"http" | "browser">().notNull(),
    status: integer("status").notNull(),
    contentType: text("content_type"),
    contentHash: text("content_hash").notNull(),
    body: text("body").notNull(),
    bytes: integer("bytes").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pages_url_via_idx").on(t.url, t.via, t.fetchedAt)],
);

export const records = pgTable(
  "records",
  {
    id: id(),
    runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    sourceId: text("source_id").notNull(),
    itemKey: text("item_key").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    status: text("status").$type<"valid" | "invalid" | "incomplete">().notNull(),
    duplicateOf: uuid("duplicate_of"),
    canonicalKey: text("canonical_key"),
    fuzzyKey: text("fuzzy_key"),
    matchScore: real("match_score").notNull().default(0),
    confidence: real("confidence").notNull().default(0),
    signals: jsonb("signals").$type<Signal[]>().notNull().default([]),
    rejectReasons: jsonb("reject_reasons").$type<string[]>().notNull().default([]),
    seenOn: jsonb("seen_on").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  // Upserting on (run, item) makes re-attempted runs idempotent.
  (t) => [uniqueIndex("records_run_item_idx").on(t.runId, t.itemKey), index("records_run_idx").on(t.runId)],
);

export const evidence = pgTable(
  "evidence",
  {
    id: id(),
    recordId: uuid("record_id").notNull().references(() => records.id, { onDelete: "cascade" }),
    field: text("field").notNull(),
    value: jsonb("value"),
    method: text("method").$type<Evidence["method"]>().notNull(),
    sourceUrl: text("source_url").notNull(),
    pageId: uuid("page_id"),
    snippet: text("snippet").notNull(),
    locator: jsonb("locator").$type<Evidence["locator"]>().notNull(),
    verified: boolean("verified").notNull(),
    confidence: real("confidence").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("evidence_record_idx").on(t.recordId)],
);

export const recipes = pgTable(
  "recipes",
  {
    id: id(),
    host: text("host").notNull(),
    pageType: text("page_type").$type<Recipe["pageType"]>().notNull(),
    urlPattern: text("url_pattern").notNull(),
    version: integer("version").notNull(),
    parentId: uuid("parent_id"),
    status: text("status").$type<Recipe["status"]>().notNull(),
    origin: text("origin").$type<Recipe["origin"]>().notNull(),
    def: jsonb("def").$type<Recipe["def"]>().notNull(),
    acceptance: jsonb("acceptance").$type<Recipe["acceptance"]>().notNull(),
    stats: jsonb("stats").$type<Recipe["stats"]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("recipes_host_type_idx").on(t.host, t.pageType, t.status)],
);

/** Curated and auto-detected companies with a verified public ATS board. */
export const registryCompanies = pgTable(
  "registry_companies",
  {
    id: id(),
    name: text("name").notNull(),
    ats: text("ats").$type<"greenhouse" | "ashby" | "lever" | "workable">().notNull(),
    slug: text("slug").notNull(),
    /** Public board page to scrape (html_list) instead of the ATS API, when set. */
    boardUrl: text("board_url"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    origin: text("origin").$type<"curated" | "auto_detected">().notNull(),
    jobCount: integer("job_count"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("registry_ats_slug_idx").on(t.ats, t.slug)],
);

/** Every decision (rules, decider model or LLM judge); doubles as a cache and future training data. */
export const decisions = pgTable(
  "decisions",
  {
    id: id(),
    runId: uuid("run_id"),
    task: text("task").notNull(),
    subject: text("subject").notNull(),
    inputHash: text("input_hash").notNull(),
    state: jsonb("state"),
    label: text("label").notNull(),
    confidence: real("confidence").notNull(),
    decidedBy: text("decided_by").$type<"RULES" | "DECIDER" | "LLM" | "DEFAULT">().notNull(),
    providerModel: text("provider_model"),
    shadow: jsonb("shadow"),
    ms: integer("ms").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("decisions_task_hash_idx").on(t.task, t.inputHash)],
);

/** Every LLM call with cost; also the response cache keyed by input hash. */
export const llmCalls = pgTable(
  "llm_calls",
  {
    id: id(),
    runId: uuid("run_id"),
    stage: text("stage").notNull(),
    model: text("model").notNull(),
    schemaName: text("schema_name").notNull(),
    inputHash: text("input_hash").notNull(),
    output: jsonb("output"),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    ms: integer("ms").notNull(),
    cached: boolean("cached").notNull().default(false),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("llm_calls_hash_idx").on(t.inputHash)],
);
