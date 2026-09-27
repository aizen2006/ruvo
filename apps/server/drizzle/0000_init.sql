CREATE TABLE "dataset_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"contract" jsonb NOT NULL,
	"model" text,
	"edited_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"task" text NOT NULL,
	"subject" text NOT NULL,
	"input_hash" text NOT NULL,
	"state" jsonb,
	"label" text NOT NULL,
	"confidence" real NOT NULL,
	"decided_by" text NOT NULL,
	"provider_model" text,
	"shadow" jsonb,
	"ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"field" text NOT NULL,
	"value" jsonb,
	"method" text NOT NULL,
	"source_url" text NOT NULL,
	"page_id" uuid,
	"snippet" text NOT NULL,
	"locator" jsonb NOT NULL,
	"verified" boolean NOT NULL,
	"confidence" real NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"stage" text NOT NULL,
	"model" text NOT NULL,
	"schema_name" text NOT NULL,
	"input_hash" text NOT NULL,
	"output" jsonb,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_usd" real DEFAULT 0 NOT NULL,
	"ms" integer NOT NULL,
	"cached" boolean DEFAULT false NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"final_url" text NOT NULL,
	"host" text NOT NULL,
	"via" text NOT NULL,
	"status" integer NOT NULL,
	"content_type" text,
	"content_hash" text NOT NULL,
	"body" text NOT NULL,
	"bytes" integer NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host" text NOT NULL,
	"page_type" text NOT NULL,
	"url_pattern" text NOT NULL,
	"version" integer NOT NULL,
	"parent_id" uuid,
	"status" text NOT NULL,
	"origin" text NOT NULL,
	"def" jsonb NOT NULL,
	"acceptance" jsonb NOT NULL,
	"stats" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"item_key" text NOT NULL,
	"data" jsonb NOT NULL,
	"status" text NOT NULL,
	"duplicate_of" uuid,
	"canonical_key" text,
	"fuzzy_key" text,
	"match_score" real DEFAULT 0 NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reject_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"seen_on" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registry_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"ats" text NOT NULL,
	"slug" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"origin" text NOT NULL,
	"job_count" integer,
	"verified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"stage" text NOT NULL,
	"type" text NOT NULL,
	"level" text NOT NULL,
	"source_id" text,
	"message" text NOT NULL,
	"data" jsonb,
	CONSTRAINT "run_events_run_id_seq_pk" PRIMARY KEY("run_id","seq")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"workflow_id" uuid,
	"status" text NOT NULL,
	"stage" text NOT NULL,
	"auto_start" boolean DEFAULT false NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"worker_id" text,
	"heartbeat_at" timestamp with time zone,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"metrics" jsonb NOT NULL,
	"quality_report" jsonb,
	"diff" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"parent_workflow_id" uuid,
	"reused_from_workflow_id" uuid,
	"plan_draft" jsonb,
	"ir" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dataset_contracts" ADD CONSTRAINT "dataset_contracts_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_contract_id_dataset_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."dataset_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decisions_task_hash_idx" ON "decisions" USING btree ("task","input_hash");--> statement-breakpoint
CREATE INDEX "evidence_record_idx" ON "evidence" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "llm_calls_hash_idx" ON "llm_calls" USING btree ("input_hash");--> statement-breakpoint
CREATE INDEX "pages_url_via_idx" ON "pages" USING btree ("url","via","fetched_at");--> statement-breakpoint
CREATE INDEX "recipes_host_type_idx" ON "recipes" USING btree ("host","page_type","status");--> statement-breakpoint
CREATE UNIQUE INDEX "records_run_item_idx" ON "records" USING btree ("run_id","item_key");--> statement-breakpoint
CREATE INDEX "records_run_idx" ON "records" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "registry_ats_slug_idx" ON "registry_companies" USING btree ("ats","slug");--> statement-breakpoint
CREATE INDEX "runs_status_created_idx" ON "runs" USING btree ("status","created_at");