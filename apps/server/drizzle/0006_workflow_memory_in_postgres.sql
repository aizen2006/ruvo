-- Plan memory compares contract summaries with pg_trgm's similarity().
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE "workflow_memory" (
	"workflow_id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"summary" text NOT NULL,
	"valid_records" integer NOT NULL,
	"plan_draft" jsonb NOT NULL,
	"remembered_at" timestamp with time zone DEFAULT now() NOT NULL
);
