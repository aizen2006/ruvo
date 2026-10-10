import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { datasetContracts, records, workflowMemory, workflows } from "../src/db/schema";
import { DEMO_CONTRACT } from "../src/plan/demoContract";
import { insertRun, resetDb } from "./helpers/db";

/** Runs a migration's SQL again, over rows written the old way after the test database was migrated. */
async function rerun(tag: string) {
  const file = readFileSync(new URL(`../drizzle/${tag}.sql`, import.meta.url), "utf8");
  for (const statement of file.split("--> statement-breakpoint")) await db.execute(sql.raw(statement));
}

beforeEach(resetDb);

describe("0010_reject_reason_codes", () => {
  test("stored reject messages get the code and fields their wording stands for", async () => {
    const run = await insertRun();
    const coded = [{ code: "missing_fields" as const, fields: ["url"], message: "Missing required field: url" }];
    const old = ["Remote: not met", "Not a valid http(s) link: website", "Missing required fields: location, salary"];
    await db.insert(records).values([
      { runId: run.id, sourceId: "src", itemKey: "old", data: {}, status: "invalid", rejectReasons: old as never },
      { runId: run.id, sourceId: "src", itemKey: "new", data: {}, status: "incomplete", rejectReasons: coded },
    ]);

    await rerun("0010_reject_reason_codes");
    const rows = await db.select().from(records).where(eq(records.runId, run.id)).orderBy(asc(records.itemKey));
    expect(rows.map((r) => r.rejectReasons)).toEqual([
      coded,
      [
        { code: "criterion_not_met", message: "Remote: not met" },
        { code: "invalid_link", fields: ["website"], message: "Not a valid http(s) link: website" },
        { code: "missing_fields", fields: ["location", "salary"], message: "Missing required fields: location, salary" },
      ],
    ]);
  });
});

describe("0011_contracts_name_a_domain", () => {
  test("stored contracts and workflows name their domain, every contract has a sensitive list, and remembered plans still match", async () => {
    const run = await insertRun();
    const { domain: _domain, sensitive: _sensitive, ...old } = DEMO_CONTRACT;
    const [, other] = await db
      .insert(datasetContracts)
      .values([
        { requestId: run.requestId, version: 1, editedBy: "llm", contract: { ...old, entity: "job_posting" } as never },
        { requestId: run.requestId, version: 2, editedBy: "user", contract: { ...old, entity: "other", sensitive: ["religion"] } as never },
      ])
      .returning();
    const [workflow] = await db.insert(workflows).values({ contractId: other!.id, version: 1, ir: { irVersion: 1, entity: "other", sources: [] } as never }).returning();
    const draft = { sources: [], llmBudget: 0, rationale: "remembered" };
    await db.insert(workflowMemory).values({ workflowId: workflow!.id, runId: run.id, summary: "entity: job_posting (Backend jobs)\nfields: title*", validRecords: 30, planDraft: draft });

    await rerun("0011_contracts_name_a_domain");
    const contracts = await db.select().from(datasetContracts).orderBy(asc(datasetContracts.version));
    expect(contracts.map((c) => c.contract)).toEqual([DEMO_CONTRACT, { ...old, domain: "generic", sensitive: ["religion"] }]);
    expect((await db.select().from(workflows))[0]!.ir).toEqual({ irVersion: 1, domain: "generic", sources: [] } as never);
    expect((await db.select().from(workflowMemory))[0]!.summary).toBe("domain: jobs (Backend jobs)\nfields: title*");
  });
});
