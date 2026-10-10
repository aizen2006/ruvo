CREATE INDEX "dataset_contracts_request_version_idx" ON "dataset_contracts" USING btree ("request_id","version");--> statement-breakpoint
CREATE INDEX "decisions_hash_idx" ON "decisions" USING btree ("input_hash");--> statement-breakpoint
CREATE INDEX "decisions_run_idx" ON "decisions" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "llm_calls_created_idx" ON "llm_calls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "search_calls_created_idx" ON "search_calls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "workflows_contract_idx" ON "workflows" USING btree ("contract_id");