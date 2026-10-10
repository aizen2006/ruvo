import { afterAll, describe, expect, test } from "bun:test";
import { env } from "../src/config/env";
import { startTestServer } from "./helpers/http";

const api = startTestServer();
afterAll(api.close);

const DASHBOARD = "http://localhost:3001";
const ELSEWHERE = "https://attacker.example";

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
      headers: { origin: DASHBOARD, "access-control-request-method": "POST" },
    });
    expect(res.headers.get("access-control-max-age")).toBe("600");
  });
});

describe("only the dashboard can call the API", () => {
  const allowedOrigin = async (server: typeof api, origin: string) =>
    (await server.raw("/health", { headers: { origin } })).headers.get("access-control-allow-origin");
  // Cancelling a run that doesn't exist changes nothing: 404 once the request is let through.
  const cancel = (server: typeof api, headers: Record<string, string>) =>
    server.post(`/api/runs/${crypto.randomUUID()}/cancel`, undefined, headers).then((r) => r.status);

  test("CORS answers the dashboard's origin and no other", async () => {
    expect(await allowedOrigin(api, DASHBOARD)).toBe(DASHBOARD);
    expect(await allowedOrigin(api, "http://127.0.0.1:3001")).toBe("http://127.0.0.1:3001");
    expect(await allowedOrigin(api, ELSEWHERE)).toBeNull();
  });

  test("a change from another website is refused; from the dashboard or without an Origin it goes through", async () => {
    expect(await cancel(api, { origin: ELSEWHERE })).toBe(403);
    expect(await cancel(api, { origin: "null" })).toBe(403);
    expect(await cancel(api, { origin: DASHBOARD })).toBe(404);
    expect(await cancel(api, {})).toBe(404);
  });

  test("a request for another host name is refused, so a website can't rebind its name to this machine", async () => {
    const health = (host: string) => api.raw("/health", { headers: { host } }).then((r) => r.status);
    expect(await health("attacker.example")).toBe(403);
    expect(await health("127.0.0.1:3000")).toBe(200);
    expect(await health("[::1]:3000")).toBe(200);
  });

  test("in production, the dashboard is CORS_ORIGINS and any host name gets through", async () => {
    const original = { ...env };
    Object.assign(env, { NODE_ENV: "production", CORS_ORIGINS: ["https://ruvo.example.com"] });
    const prod = startTestServer();
    Object.assign(env, original);
    try {
      const res = await prod.raw("/health", { headers: { host: "api.ruvo.example.com", origin: "https://ruvo.example.com" } });
      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBe("https://ruvo.example.com");
      expect(await allowedOrigin(prod, DASHBOARD)).toBeNull();
      expect(await cancel(prod, { origin: DASHBOARD })).toBe(403);
      expect(await cancel(prod, { origin: "https://ruvo.example.com" })).toBe(404);
    } finally {
      prod.close();
    }
  });
});
