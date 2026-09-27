import type { AddressInfo } from "node:net";
import { createApp } from "../../src/app";

/** Starts the real Express app on a random port for request-level tests. */
export function startTestServer() {
  const server = createApp().listen(0);
  const url = `http://localhost:${(server.address() as AddressInfo).port}`;

  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`${url}${path}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  };

  return {
    get: (path: string) => call("GET", path),
    post: (path: string, body?: unknown, headers?: Record<string, string>) => call("POST", path, body, headers),
    raw: (path: string, init?: RequestInit) => fetch(`${url}${path}`, init),
    close: () => server.close(),
  };
}
