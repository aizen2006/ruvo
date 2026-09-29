import { afterAll, describe, expect, test } from "bun:test";
import { startTestServer } from "./helpers/http";

const api = startTestServer();
afterAll(api.close);

describe("app", () => {
  test("GET /health returns ok", async () => {
    expect(await api.get("/health")).toEqual({ status: 200, body: { status: "ok" } });
  });

  test("unknown route returns 404 JSON", async () => {
    const res = await api.get("/nope");
    expect(res.status).toBe(404);
    expect(res.body.error).toContain("not found");
  });

  test("malformed JSON body returns 400", async () => {
    const res = await api.raw("/health", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{bad json",
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("Malformed JSON body");
  });

  test("oversized body returns 413, not 500", async () => {
    const res = await api.post("/api/runs", { prompt: "x".repeat(1_100_000) });
    expect(res.status).toBe(413);
  });

  test("oversized Idempotency-Key returns 400", async () => {
    const res = await api.post("/api/runs", { prompt: "Jobs at Acme" }, { "Idempotency-Key": "k".repeat(201) });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Idempotency-Key");
  });

  test("CORS preflights are cached", async () => {
    const res = await api.raw("/api/runs", {
      method: "OPTIONS",
      headers: { origin: "https://dashboard.example", "access-control-request-method": "POST" },
    });
    expect(res.headers.get("access-control-max-age")).toBe("600");
  });
});
