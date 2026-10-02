import { beforeEach, describe, expect, test } from "bun:test";
import type { DatasetContract, PlanDraft } from "@repo/contracts";
import { db } from "../src/db/client";
import { workflowMemory } from "../src/db/schema";
import { logger } from "../src/libs/logger";
import { contractSummary, createWorkflowMemory, REUSE_MIN_VALID } from "../src/memory/workflowMemory";
import { DEMO_CONTRACT } from "../src/plan/demoContract";
import { resetDb } from "./helpers/db";

const DRAFT: PlanDraft = { sources: [], fieldStrategies: [], llmBudget: 5, rationale: "remembered" };
const memory = createWorkflowMemory({ log: logger });

/** The same request worded differently: the compiler names things a little differently. */
const REWORDED: DatasetContract = {
  ...DEMO_CONTRACT,
  entityDescription: "Backend and AI engineering jobs that are open now",
  criteria: DEMO_CONTRACT.criteria.map((c) => (c.id === "remote_preferred" ? { ...c, label: "Remote preferred" } : c)),
};

/** A different request: one company's jobs, no role rules. */
const DIFFERENT: DatasetContract = {
  ...DEMO_CONTRACT,
  entityDescription: "Engineering jobs at Hugging Face",
  criteria: [],
  assumptions: [],
  sourceHints: { ...DEMO_CONTRACT.sourceHints, companies: ["Hugging Face"], companyTags: [] },
};

beforeEach(resetDb);

describe("contractSummary", () => {
  test("ignores the order of fields and criteria", () => {
    const shuffled = { ...DEMO_CONTRACT, fields: [...DEMO_CONTRACT.fields].reverse(), criteria: [...DEMO_CONTRACT.criteria].reverse() };
    expect(contractSummary(shuffled)).toBe(contractSummary(DEMO_CONTRACT));
  });
});

describe("workflow memory", () => {
  const input = { workflowId: crypto.randomUUID(), runId: crypto.randomUUID(), contract: DEMO_CONTRACT, draft: DRAFT };

  test("remembers good plans only, and recalls them for the same request", async () => {
    expect(await memory.remember({ ...input, validRecords: 5 })).toBe(false);
    expect(await memory.remember({ ...input, validRecords: 120 })).toBe(true);
    expect(await memory.recall(DEMO_CONTRACT)).toMatchObject({ workflowId: input.workflowId, runId: input.runId, draft: DRAFT, score: 1 });
  });

  test("reuses a plan for a reworded request but not for a different one", async () => {
    await memory.remember({ ...input, validRecords: 120 });
    expect(await memory.recall(REWORDED)).toMatchObject({ workflowId: input.workflowId });
    expect(await memory.recall(DIFFERENT)).toBeNull();
  });

  test("remembering the same workflow again updates it", async () => {
    await memory.remember({ ...input, validRecords: 120 });
    await memory.remember({ ...input, validRecords: 300, draft: { ...DRAFT, rationale: "updated" } });
    const rows = await db.select().from(workflowMemory);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ validRecords: 300, planDraft: { rationale: "updated" } });
  });

  test("ignores plans whose runs produced too few valid records", async () => {
    await db.insert(workflowMemory).values({ workflowId: input.workflowId, runId: input.runId, summary: contractSummary(DEMO_CONTRACT), validRecords: REUSE_MIN_VALID - 1, planDraft: DRAFT });
    expect(await memory.recall(DEMO_CONTRACT)).toBeNull();
  });

  test("never throws", async () => {
    const broken = {} as DatasetContract;
    expect(await memory.recall(broken)).toBeNull();
    expect(await memory.remember({ ...input, contract: broken, validRecords: 120 })).toBe(false);
  });
});
