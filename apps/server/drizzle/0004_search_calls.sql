CREATE TABLE "search_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"provider" text NOT NULL,
	"query" text NOT NULL,
	"input_hash" text NOT NULL,
	"hits" jsonb,
	"credits" integer DEFAULT 0 NOT NULL,
	"cost_usd" real DEFAULT 0 NOT NULL,
	"cached" boolean DEFAULT false NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "search_calls_hash_idx" ON "search_calls" USING btree ("input_hash");--> statement-breakpoint
CREATE INDEX "search_calls_run_idx" ON "search_calls" USING btree ("run_id");