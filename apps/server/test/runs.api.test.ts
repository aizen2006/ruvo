import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { runPipeline } from "../src/runs/pipeline";
import { startWorker } from "../src/runs/worker";
import { resetDb, waitFor } from "./helpers/db";
import { startTestServer } from "./helpers/http";

const api = startTestServer();
afterAll(api.close);
beforeEach(resetDb);

const prompt = "Find backend and AI engineering roles, preferably remote.";

describe("runs API", () => {
  test("rejects a prompt that is too short", async () => {
    const res = await api.post("/api/runs", { prompt: "jobs" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });

  test("creates a run awaiting approval, visible in detail and history", async () => {
    const created = await api.post("/api/runs", { prompt });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("awaiting_approval");

    const detail = await api.get(`/api/runs/${created.body.runId}`);
    expect(detail.body).toMatchObject({ id: created.body.runId, prompt, status: "awaiting_approval", contract: null });

    const history = await api.get("/api/runs");
    expect(history.body.map((r: { id: string }) => r.id)).toEqual([created.body.runId]);
  });

  test("an idempotency key returns the original run", async () => {
    const headers = { "Idempotency-Key": "abc-123" };
    const first = await api.post("/api/runs", { prompt }, headers);
    const second = await api.post("/api/runs", { prompt }, headers);
    expect(second.body.runId).toBe(first.body.runId);
  });

  test("start only works from awaiting_approval", async () => {
    const { body } = await api.post("/api/runs", { prompt });
    expect((await api.post(`/api/runs/${body.runId}/start`)).body.status).toBe("queued_run");
    expect((await api.post(`/api/runs/${body.runId}/start`)).status).toBe(409);
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

  test("an auto-started run is executed by the worker and records lifecycle events", async () => {
    const worker = startWorker({ execute: runPipeline, pollMs: 20, heartbeatMs: 50 });
    const { body } = await api.post("/api/runs", { prompt, autoStart: true });

    await waitFor(() => api.get(`/api/runs/${body.runId}`), (r) => r.body.status === "completed");
    const events = await api.get(`/api/runs/${body.runId}/events`);
    const types = events.body.map((e: { type: string }) => e.type);
    expect(types[0]).toBe("run.claimed");
    expect(types.at(-1)).toBe("run.completed");

    const after = await api.get(`/api/runs/${body.runId}/events?after=1`);
    expect(after.body[0].seq).toBe(2);
    await worker.stop();
  });
});
