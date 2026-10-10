import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { records } from "../src/db/schema";
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
