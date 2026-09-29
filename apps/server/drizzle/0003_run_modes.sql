ALTER TABLE "runs" ADD COLUMN "mode" text DEFAULT 'balanced' NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "model_planner" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "model_worker" text;--> statement-breakpoint
CREATE INDEX "llm_calls_run_idx" ON "llm_calls" USING btree ("run_id");