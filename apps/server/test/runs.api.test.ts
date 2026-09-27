import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type { DatasetContract, PlanDraft } from "@repo/contracts";
import { createLlmClient } from "../src/llm/client";
import { DEMO_CONTRACT } from "../src/plan/demoContract";
import { syncCuratedRegistry } from "../src/plan/registry";
import { createPreparer } from "../src/runs/prepare";
import { startWorker, type RunExecutor } from "../src/runs/worker";
import { insertRun, resetDb, waitFor } from "./helpers/db";
import { fakeResponses } from "./helpers/fakeLlm";
import { startTestServer } from "./helpers/http";

const api = startTestServer();
afterAll(api.close);
beforeEach(async () => {
  await resetDb();
  await syncCuratedRegistry();
});

const prompt = "Find backend and AI engineering roles, preferably remote.";

/** A planner reply that includes every candidate the planner was shown. */
const planAll = ({ input }: { input: Array<{ content: string }> }): PlanDraft => {
  const { candidates } = JSON.parse(input.at(-1)!.content) as { candidates: Array<{ ref: string }> };
  return {
    sources: candidates.map((c) => ({ ref: c.ref, include: true, reason: "test", titleKeywords: [], fetchDetails: false, maxItems: 10 })),
    fieldStrategies: [],
    llmBudget: 5,
    rationale: "test plan",
  };
};

/** A worker that prepares with a fake LLM and executes with a no-op (no network). */
function testWorker(execute: RunExecutor = async () => {}) {
  const fake = fakeResponses({ dataset_contract: DEMO_CONTRACT, plan_draft: planAll });
  const llm = createLlmClient({
    env: { MODEL_PLANNER: "gpt-6-sol", MODEL_WORKER: "gpt-6-luna", LLM_CACHE_MODE: "off", OPENAI_API_KEY: "x" },
    responses: fake.responses,
  });
  return startWorker({ execute, prepare: createPreparer({ llm }), pollMs: 20, heartbeatMs: 50 });
}

const status = (runId: string) => api.get(`/api/runs/${runId}`).then((r) => r.body.status as string);

describe("runs API", () => {
  test("rejects a prompt that is too short", async () => {
    const res = await api.post("/api/runs", { prompt: "jobs" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });

  test("new runs are queued for preparation and appear in history", async () => {
    const created = await api.post("/api/runs", { prompt });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("queued");
    expect((await api.get(`/api/runs/${created.body.runId}`)).body).toMatchObject({ prompt, contract: null });
    expect((await api.get("/api/runs")).body.map((r: { id: string }) => r.id)).toEqual([created.body.runId]);
  });

  test("an idempotency key returns the original run", async () => {
    const headers = { "Idempotency-Key": "abc-123" };
    const first = await api.post("/api/runs", { prompt }, headers);
    const second = await api.post("/api/runs", { prompt }, headers);
    expect(second.body.runId).toBe(first.body.runId);
  });

  test("start only works from awaiting_approval", async () => {
    const run = await insertRun({ status: "awaiting_approval" });
    expect((await api.post(`/api/runs/${run.id}/start`)).body.status).toBe("queued_run");
    expect((await api.post(`/api/runs/${run.id}/start`)).status).toBe(409);
  });

  test("cancel stops a pending run and refuses a finished one", async () => {
    const { body } = await api.post("/api/runs", { prompt });
    expect((await api.post(`/api/runs/${body.runId}/cancel`)).body.status).toBe("cancelled");
    expect((await api.post(`/api/runs/${body.runId}/cancel`)).status).toBe(409);
  });

  test("unknown or malformed ids return 404", async () => {
    expect((await api.get("/api/runs/not-a-uuid")).status).toBe(404);
    expect((await api.get("/api/runs/00000000-0000-0000-0000-000000000000")).status).toBe(404);
  });
});

describe("run lifecycle", () => {
  test("prepare → review → start → execute, with contract and workflow visible for review", async () => {
    const worker = testWorker();
    const { body } = await api.post("/api/runs", { prompt });

    await waitFor(() => status(body.runId), (s) => s === "awaiting_approval");
    const detail = await api.get(`/api/runs/${body.runId}`);
    expect(detail.body.contract.title).toBe(DEMO_CONTRACT.title);

    const workflow = await api.get(`/api/runs/${body.runId}/workflow`);
    expect(workflow.body.ir.provenance).toMatchObject({ plannedBy: "llm", model: "gpt-6-sol" });
    expect(workflow.body.ir.sources.length).toBeGreaterThan(0);

    await api.post(`/api/runs/${body.runId}/start`);
    await waitFor(() => status(body.runId), (s) => s === "completed");

    const types = (await api.get(`/api/runs/${body.runId}/events`)).body.map((e: { type: string }) => e.type);
    expect(types).toEqual(expect.arrayContaining(["compile.completed", "discovery.completed", "plan.completed", "run.claimed", "run.completed"]));
    await worker.stop();
  });

  test("autoStart skips review", async () => {
    const worker = testWorker();
    const { body } = await api.post("/api/runs", { prompt, autoStart: true });
    await waitFor(() => status(body.runId), (s) => s === "completed");
    await worker.stop();
  });

  test("editing the contract recompiles the workflow without an LLM call", async () => {
    const worker = testWorker();
    const { body } = await api.post("/api/runs", { prompt });
    await waitFor(() => status(body.runId), (s) => s === "awaiting_approval");
    await worker.stop();

    // Narrow the request to AI infrastructure companies only.
    const edited: DatasetContract = {
      ...DEMO_CONTRACT,
      criteria: DEMO_CONTRACT.criteria.map((c) => (c.kind === "company_tag" ? { ...c, values: ["ai_infra"], strength: "hard" } : c)),
      sourceHints: { ...DEMO_CONTRACT.sourceHints, companyTags: ["ai_infra"] },
    };
    const res = await api.raw(`/api/runs/${body.runId}/contract`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contract: edited }),
    });
    expect(res.status).toBe(200);

    const workflow = (await api.get(`/api/runs/${body.runId}/workflow`)).body;
    expect(workflow.ir.provenance.plannedBy).toBe("user_edit");
    expect(workflow.versions.map((v: { plannedBy: string }) => v.plannedBy)).toEqual(["user_edit", "llm"]);
    expect(workflow.contractVersion).toBe(2);
    expect(workflow.ir.sources.every((s: { label: string }) => !["Anthropic", "OpenAI"].includes(s.label))).toBe(true);
  });

  test("the contract cannot be edited once the run has started", async () => {
    const run = await insertRun({ status: "running" });
    const res = await api.raw(`/api/runs/${run.id}/contract`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contract: DEMO_CONTRACT }),
    });
    expect(res.status).toBe(409);
  });

  test("rerun creates a new run of the same workflow", async () => {
    const worker = testWorker();
    const { body } = await api.post("/api/runs", { prompt, autoStart: true });
    await waitFor(() => status(body.runId), (s) => s === "completed");

    const rerun = await api.post(`/api/runs/${body.runId}/rerun`);
    expect(rerun.status).toBe(201);
    await waitFor(() => status(rerun.body.runId), (s) => s === "completed");
    const [a, b] = await Promise.all([body.runId, rerun.body.runId].map((id) => api.get(`/api/runs/${id}`)));
    expect(b!.body.workflowId).toBe(a!.body.workflowId);
    await worker.stop();
  });
});
