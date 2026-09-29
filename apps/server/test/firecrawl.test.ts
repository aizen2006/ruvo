import { describe, expect, test } from "bun:test";
import { createFirecrawl, FirecrawlError } from "../src/search/firecrawl";

/** A fake fetch that records the requests and replays queued responses. */
function fakeFetch(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Array<{ url: string; method: string; body: unknown; auth: string | null }> = [];
  let i = 0;
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? "GET",
      body: init.body ? JSON.parse(init.body as string) : undefined,
      auth: new Headers(init.headers).get("authorization"),
    });
    const next = responses[Math.min(i++, responses.length - 1)]!;
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const client = (fetchImpl: typeof fetch) => createFirecrawl({ apiKey: "fc-test", fetchImpl });

describe("firecrawl client", () => {
  test("search sends the documented body and maps web results", async () => {
    const { impl, calls } = fakeFetch([
      { body: { success: true, data: { web: [{ url: "https://a.com", title: "A", description: "d", position: 1 }] }, creditsUsed: 1 } },
    ]);
    const res = await client(impl).search("best climate podcasts", { limit: 20 });

    expect(calls[0]).toMatchObject({
      url: "https://api.firecrawl.dev/v2/search",
      method: "POST",
      auth: "Bearer fc-test",
      body: { query: "best climate podcasts", limit: 20, sources: ["web"], ignoreInvalidURLs: true },
    });
    expect(res.web).toEqual([{ url: "https://a.com", title: "A", description: "d", position: 1 }]);
    expect(res.creditsUsed).toBe(1);
  });

  test("scrape defaults to main-content markdown", async () => {
    const { impl, calls } = fakeFetch([{ body: { success: true, data: { markdown: "# Title", metadata: { statusCode: 200 } }, creditsUsed: 1 } }]);
    const res = await client(impl).scrape("https://x.com/page");
    expect(calls[0]!.body).toMatchObject({ url: "https://x.com/page", formats: ["markdown"], onlyMainContent: true });
    expect(res.document.markdown).toBe("# Title");
  });

  test("extract passes urls, schema and prompt", async () => {
    const { impl, calls } = fakeFetch([{ body: { success: true, data: { rows: [] }, sources: {}, creditsUsed: 5 } }]);
    await client(impl).extract({ urls: ["https://a.com"], prompt: "founders", schema: { type: "object" } });
    expect(calls[0]).toMatchObject({ url: "https://api.firecrawl.dev/v2/extract", method: "POST", body: { urls: ["https://a.com"], prompt: "founders", schema: { type: "object" } } });
  });

  test("retries a 429 then succeeds", async () => {
    const { impl, calls } = fakeFetch([
      { status: 429, body: { success: false, error: "rate limited" } },
      { body: { success: true, data: { web: [] }, creditsUsed: 0 } },
    ]);
    const res = await client(impl).search("q");
    expect(calls).toHaveLength(2);
    expect(res.web).toEqual([]);
  });

  test("throws a non-retryable error on 402 (out of credits)", async () => {
    const { impl, calls } = fakeFetch([{ status: 402, body: { success: false, error: "Insufficient credits" } }]);
    await expect(client(impl).search("q")).rejects.toBeInstanceOf(FirecrawlError);
    expect(calls).toHaveLength(1);
  });
});
