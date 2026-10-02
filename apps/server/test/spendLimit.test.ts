import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "../src/db/client";
import { assertUnderDailyBudget } from "../src/db/repos/runs";
import { llmCalls, searchCalls } from "../src/db/schema";
import { resetDb } from "./helpers/db";

beforeEach(resetDb);

const HOUR = 3_600_000;
const llmCall = (costUsd: number, createdAt = new Date()) => ({
  stage: "compile",
  model: "gpt-6-sol",
  schemaName: "dataset_contract",
  inputHash: crypto.randomUUID(),
  ms: 1,
  costUsd,
  createdAt,
});

describe("daily spending limit", () => {
  test("allows new work while the last 24 hours stay under the limit", async () => {
    await db.insert(llmCalls).values([llmCall(0.4), llmCall(5, new Date(Date.now() - 25 * HOUR))]);
    await db.insert(searchCalls).values({ provider: "firecrawl", query: "q", inputHash: "h", costUsd: 0.5 });
    await expect(assertUnderDailyBudget(1)).resolves.toBeUndefined();
  });

  test("refuses new work once AI and search spend reach the limit", async () => {
    await db.insert(llmCalls).values(llmCall(0.6));
    await db.insert(searchCalls).values({ provider: "firecrawl", query: "q", inputHash: "h", costUsd: 0.4 });
    await expect(assertUnderDailyBudget(1)).rejects.toMatchObject({ status: 429 });
  });

  test("has no limit when DAILY_BUDGET_USD is unset", async () => {
    await db.insert(llmCalls).values(llmCall(1000));
    await expect(assertUnderDailyBudget(undefined)).resolves.toBeUndefined();
  });
});
