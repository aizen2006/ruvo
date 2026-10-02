import { afterAll, describe, expect, test } from "bun:test";
import { FetchError } from "../src/fetch/errors";
import { createScraplingClient } from "../src/fetch/scrapling";

const failures: Record<string, [number, string]> = {
  "https://site.example/blocked": [502, "blocked"],
  "https://site.example/network": [502, "network"],
  "https://site.example/timeout": [504, "timeout"],
  "https://site.example/large": [502, "too_large"],
};
let lastRequest: unknown;
let slowCallCancelled: PromiseWithResolvers<void>;

/** A stand-in for infra/scrapling/server.py's POST /fetch. */
const service = Bun.serve({
  port: 0,
  async fetch(req) {
    const body = (await req.json()) as { url: string };
    lastRequest = body;
    if (body.url === "https://site.example/slow") {
      req.signal.addEventListener("abort", () => slowCallCancelled.resolve());
      await Bun.sleep(5_000);
    }
    const failure = failures[body.url];
    if (failure) return Response.json({ error: failure[1], message: `${failure[1]} failure` }, { status: failure[0] });
    const page = "<p>Café ✓ 東京</p>";
    return Response.json({ status: 200, url: body.url, headers: { "content-type": "text/html" }, body: Buffer.from(page).toString("base64") });
  },
});
afterAll(() => service.stop(true));

const client = createScraplingClient(`http://127.0.0.1:${service.port}`);
const req = (path: string) => ({ url: `https://site.example/${path}`, engine: "http" as const, timeoutMs: 1000, maxBytes: 1000 });
const signal = () => new AbortController().signal;
const failureKind = async (p: Promise<unknown>) => ((await p.catch((e: unknown) => e)) as FetchError).kind;

describe("Scrapling client", () => {
  test("sends the request and decodes the base64 body as UTF-8", async () => {
    const page = await client.fetch(req("ok"), signal());
    expect(page).toEqual({ status: 200, url: "https://site.example/ok", headers: { "content-type": "text/html" }, body: "<p>Café ✓ 東京</p>" });
    expect(lastRequest).toEqual({ ...req("ok"), accept: null });
  });

  test("maps the service's failures to fetch errors", async () => {
    expect(await failureKind(client.fetch(req("blocked"), signal()))).toBe("ssrf_blocked");
    expect(await failureKind(client.fetch(req("network"), signal()))).toBe("network");
    expect(await failureKind(client.fetch(req("timeout"), signal()))).toBe("network");
    expect(await failureKind(client.fetch(req("large"), signal()))).toBe("too_large");
  });

  test("an unreachable service is service_down", async () => {
    const down = Bun.serve({ port: 0, fetch: () => new Response() });
    const url = `http://127.0.0.1:${down.port}`;
    await down.stop(true);
    expect(await failureKind(createScraplingClient(url).fetch(req("ok"), signal()))).toBe("service_down");
  });

  test("aborting rejects with the abort, not a fetch error, and cancels the service's call", async () => {
    slowCallCancelled = Promise.withResolvers();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const error = await client.fetch(req("slow"), controller.signal).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(FetchError);
    expect((error as Error).name).toBe("AbortError");
    await slowCallCancelled.promise;
  });
});
