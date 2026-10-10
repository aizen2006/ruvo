DROP INDEX "recipes_host_type_idx";--> statement-breakpoint
CREATE INDEX "recipes_host_status_idx" ON "recipes" USING btree ("host","status");--> statement-breakpoint
ALTER TABLE "recipes" DROP COLUMN "page_type";