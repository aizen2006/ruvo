import { beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { db } from "../src/db/client";
import { llmCalls } from "../src/db/schema";
import { createLlmClient, LlmError } from "../src/llm/client";
import { costUsd } from "../src/llm/models";
import { createBudget } from "../src/runs/budget";
import { createMetrics } from "../src/runs/metrics";
import { resetDb } from "./helpers/db";
import { fakeResponses } from "./helpers/fakeLlm";

beforeEach(resetDb);

const Answer = z.object({ city: z.string() });
const env = { MODEL_PLANNER: "gpt-6-sol", MODEL_WORKER: "gpt-6-luna", LLM_CACHE_MODE: "on" as const, OPENAI_API_KEY: "test" };
const request = { stage: "test", role: "planner" as const, schema: Answer, name: "answer", system: "sys", user: "capital of France?" };

describe("llm client", () => {
  test("parses, logs cost, then serves identical calls from cache", async () => {
    const fake = fakeResponses({ answer: { city: "Paris" } });
    const llm = createLlmClient({ env, responses: fake.responses });

    const first = await llm.parse(request);
    const second = await llm.parse(request);
    expect(first).toMatchObject({ data: { city: "Paris" }, cached: false, model: "gpt-6-sol" });
    expect(first.usage.costUsd).toBeCloseTo(costUsd("gpt-6-sol", 1000, 200));
    expect(second).toMatchObject({ data: { city: "Paris" }, cached: true });
    expect(fake.calls).toHaveLength(1);
    expect(await db.select().from(llmCalls)).toHaveLength(2);
  });

  test("a different prompt is not a cache hit", async () => {
    const fake = fakeResponses({ answer: { city: "Paris" } });
    const llm = createLlmClient({ env, responses: fake.responses });
    await llm.parse(request);
    await llm.parse({ ...request, user: "capital of Italy?" });
    expect(fake.calls).toHaveLength(2);
  });

  test("cache_only mode refuses to call the API on a miss", async () => {
    const llm = createLlmClient({ env: { ...env, LLM_CACHE_MODE: "cache_only" }, responses: fakeResponses({}).responses });
    await expect(llm.parse(request)).rejects.toMatchObject({ kind: "cache_miss" });
  });

  test("counts calls against the run budget and metrics", async () => {
    const budget = createBudget({ maxPages: 1, maxBrowserPages: 0, maxLlmCalls: 1, maxDurationMs: 1000, maxRecords: 1 });
    const metrics = createMetrics();
    const run = { runId: crypto.randomUUID(), budget, metrics };
    const llm = createLlmClient({ env: { ...env, LLM_CACHE_MODE: "off" }, responses: fakeResponses({ answer: { city: "Paris" } }).responses });

    await llm.parse({ ...request, run });
    await expect(llm.parse({ ...request, run })).rejects.toMatchObject({ kind: "budget_exhausted" });
    expect(metrics.snapshot().llmCalls).toBe(1);
    expect(metrics.snapshot().llmCostUsd).toBeGreaterThan(0);
  });

  test("surfaces refusals as typed errors and logs them", async () => {
    const llm = createLlmClient({ env, responses: fakeResponses({}, { refuse: ["answer"] }).responses });
    const error = await llm.parse(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect(error).toMatchObject({ kind: "refusal" });
    const [row] = await db.select().from(llmCalls);
    expect(row!.error).toContain("refused");
  });
});
