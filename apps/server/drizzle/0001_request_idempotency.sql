ALTER TABLE "requests" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_idempotency_key_unique" UNIQUE("idempotency_key");