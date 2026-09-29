import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { estimateRunCost, type PlanDraft } from "@repo/contracts";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../src/db/client";
import { llmCalls, workflows } from "../src/db/schema";
import { createLlmClient, scopeLlm } from "../src/llm/client";
import { modelCatalog } from "../src/llm/models";
import { DEMO_CONTRACT } from "../src/plan/demoContract";
import { syncCuratedRegistry } from "../src/plan/registry";
import { budgetsForMode, modelsForMode, modeOptions } from "../src/runs/modes";
import { createPreparer } from "../src/runs/prepare";
import { startWorker } from "../src/runs/worker";
import { resetDb, waitFor } from "./helpers/db";
import { fakeResponses } from "./helpers/fakeLlm";
import { startTestServer } from "./helpers/http";

const api = startTestServer();
afterAll(api.close);
beforeEach(resetDb);

const models = { MODEL_PLANNER: "gpt-6-sol", MODEL_WORKER: "gpt-6-luna" };
const ceilings = { MAX_PAGES: 300, MAX_BROWSER_PAGES: 20, MAX_LLM_CALLS: 150, MAX_RUN_MS: 480_000 };
const prompt = "Find backend and AI engineering roles, preferably remote.";

describe("mode presets", () => {
  test("each mode has its own budgets and models", () => {
    const byId = Object.fromEntries(modeOptions({ ...models, ...ceilings }).map((m) => [m.id, m]));
    expect(byId.quick!.budgets.maxLlmCalls).toBeLessThan(byId.balanced!.budgets.maxLlmCalls);
    expect(byId.balanced!.budgets.maxLlmCalls).toBeLessThan(byId.thorough!.budgets.maxLlmCalls);
    expect(byId.quick!.models).toEqual({ planner: "gpt-6-luna", worker: "gpt-6-luna" });
    expect(byId.balanced!.models).toEqual({ planner: "gpt-6-sol", worker: "gpt-6-luna" });
    expect(byId.thorough!.models).toEqual({ planner: "gpt-6-sol", worker: "gpt-6-sol" });
  });

  test("the environment's limits are ceilings no mode exceeds", () => {
    const tight = { MAX_PAGES: 100, MAX_BROWSER_PAGES: 5, MAX_LLM_CALLS: 30, MAX_RUN_MS: 60_000 };
    expect(budgetsForMode("thorough", tight, 200)).toEqual({ maxPages: 100, maxBrowserPages: 5, maxLlmCalls: 30, maxDurationMs: 60_000, maxRecords: 200 });
    expect(budgetsForMode("quick", ceilings).maxPages).toBe(40);
  });

  test("an explicit model choice overrides the mode's, blanks do not", () => {
    expect(modelsForMode("balanced", { worker: "gpt-6-astra" }, models)).toEqual({ planner: "gpt-6-sol", worker: "gpt-6-astra" });
    expect(modelsForMode("quick", { planner: "" }, models)).toEqual({ planner: "gpt-6-luna", worker: "gpt-6-luna" });
  });

  test("estimates grow with the models and the call budget", () => {
    const catalog = modelCatalog();
    const cheap = estimateRunCost({ planner: "gpt-6-luna", worker: "gpt-6-luna" }, 15, catalog);
    const careful = estimateRunCost({ planner: "gpt-6-sol", worker: "gpt-6-sol" }, 150, catalog);
    expect(cheap.typicalUsd).toBeLessThanOrEqual(cheap.highUsd);
    expect(careful.typicalUsd).toBeGreaterThan(cheap.highUsd);
  });
});

describe("per-run models and cost", () => {
  test("a scoped client routes each role to the run's model and tags calls with the run", async () => {
    const fake = fakeResponses({ answer: { ok: true } });
    const base = createLlmClient({ env: { ...models, LLM_CACHE_MODE: "off", OPENAI_API_KEY: "x" }, responses: fake.responses });
    const { body } = await api.post("/api/runs", { prompt });
    const llm = scopeLlm(base, { models: { planner: "gpt-6-astra", worker: "gpt-6-sol" }, runId: body.runId });

    const ask = { stage: "t", schema: z.object({ ok: z.boolean() }), name: "answer", system: "s", user: "u" };
    await llm.parse({ ...ask, role: "planner" });
    await llm.parse({ ...ask, role: "worker" });
    expect(fake.calls.map((c) => c.model)).toEqual(["gpt-6-astra", "gpt-6-sol"]);

    const rows = await db.select().from(llmCalls).where(eq(llmCalls.runId, body.runId));
    expect(rows).toHaveLength(2);
    const detail = await api.get(`/api/runs/${body.runId}`);
    expect(detail.body.costUsd).toBeCloseTo(rows.reduce((sum, r) => sum + r.costUsd, 0), 6);
  });

  test("runs store their mode and resolved models", async () => {
    const created = await api.post("/api/runs", { prompt, mode: "thorough", models: { worker: "gpt-6-astra" } });
    const detail = (await api.get(`/api/runs/${created.body.runId}`)).body;
    expect(detail).toMatchObject({ mode: "thorough", models: { planner: "gpt-6-sol", worker: "gpt-6-astra" }, costUsd: 0 });
    expect((await api.get("/api/runs")).body[0].mode).toBe("thorough");
  });

  test("unknown models are rejected", async () => {
    const res = await api.post("/api/runs", { prompt, models: { planner: "gpt-2" } });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("gpt-2");
  });

  test("GET /api/options lists modes and priced models", async () => {
    const { status, body } = await api.get("/api/options");
    expect(status).toBe(200);
    expect(body.defaultMode).toBe("balanced");
    expect(body.modes.map((m: { id: string }) => m.id)).toEqual(["quick", "balanced", "thorough"]);
    expect(body.models.find((m: { id: string }) => m.id === "gpt-6-luna")).toMatchObject({ inputPerMillion: 0.1, outputPerMillion: 0.5 });
  });

  test("preparing a quick run uses its models and budgets and counts compile and plan in its cost", async () => {
    await syncCuratedRegistry();
    const planAll = ({ input }: { input: Array<{ content: string }> }): PlanDraft => {
      const { candidates } = JSON.parse(input.at(-1)!.content) as { candidates: Array<{ ref: string }> };
      const sources = candidates.map((c) => ({ ref: c.ref, include: true, reason: "t", titleKeywords: [], fetchDetails: false, maxItems: 10 }));
      return { sources, fieldStrategies: [], llmBudget: 500, rationale: "t" };
    };
    const fake = fakeResponses({ dataset_contract: DEMO_CONTRACT, plan_draft: planAll });
    const llm = createLlmClient({ env: { ...models, LLM_CACHE_MODE: "off", OPENAI_API_KEY: "x" }, responses: fake.responses });
    const worker = startWorker({ execute: async () => {}, prepare: createPreparer({ llm }), pollMs: 20, heartbeatMs: 50 });

    const { body } = await api.post("/api/runs", { prompt, mode: "quick" });
    await waitFor(() => api.get(`/api/runs/${body.runId}`).then((r) => r.body.status), (s) => s === "awaiting_approval");
    await worker.stop();

    expect(fake.calls.map((c) => [c.name, c.model])).toEqual([
      ["dataset_contract", "gpt-6-luna"],
      ["plan_draft", "gpt-6-luna"],
    ]);
    const detail = (await api.get(`/api/runs/${body.runId}`)).body;
    expect(detail.costUsd).toBeGreaterThan(0);

    const [workflow] = await db.select({ ir: workflows.ir }).from(workflows).where(eq(workflows.id, detail.workflowId));
    expect(workflow!.ir.budgets.maxLlmCalls).toBeLessThanOrEqual(15);
    expect(workflow!.ir.budgets.maxPages).toBeLessThanOrEqual(40);
  });
});
