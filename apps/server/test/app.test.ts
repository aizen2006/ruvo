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
});
