import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app";

let server: Server;
let baseUrl: string;

beforeAll(() => {
  server = createApp().listen(0);
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

describe("app", () => {
  test("GET /health returns ok", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("unknown route returns 404 JSON", async () => {
    const res = await fetch(`${baseUrl}/nope`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toContain("not found");
  });

  test("malformed JSON body returns 400", async () => {
    const res = await fetch(`${baseUrl}/health`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{bad json",
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("Malformed JSON body");
  });
});
