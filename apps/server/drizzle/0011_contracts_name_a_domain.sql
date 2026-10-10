-- Contracts and workflows name a domain pack instead of an entity: job_posting is now jobs, other is generic.
-- Stored contracts are plain JSON that is never parsed again, so they are rewritten here.
UPDATE "dataset_contracts"
SET "contract" = ("contract" - 'entity') || jsonb_build_object('domain', CASE "contract"->>'entity' WHEN 'job_posting' THEN 'jobs' ELSE 'generic' END)
WHERE "contract"->'entity' IS NOT NULL;
--> statement-breakpoint
-- Matching reads every contract's sensitive list; contracts saved before it existed get an empty one.
UPDATE "dataset_contracts" SET "contract" = "contract" || '{"sensitive": []}'::jsonb WHERE "contract"->'sensitive' IS NULL;
--> statement-breakpoint
UPDATE "workflows"
SET "ir" = ("ir" - 'entity') || jsonb_build_object('domain', CASE "ir"->>'entity' WHEN 'job_posting' THEN 'jobs' ELSE 'generic' END)
WHERE "ir"->'entity' IS NOT NULL;
--> statement-breakpoint
-- Remembered plans are found by their contract's summary, which now starts with its domain.
UPDATE "workflow_memory"
SET "summary" = regexp_replace(regexp_replace("summary", '^entity: job_posting \(', 'domain: jobs ('), '^entity: other \(', 'domain: generic (')
WHERE "summary" LIKE 'entity: %';
