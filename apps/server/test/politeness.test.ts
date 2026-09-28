import { describe, expect, test } from "bun:test";
import { FetchError } from "../src/fetch/errors";
import { createHostLimiter } from "../src/fetch/hostLimiter";
import { createRobots } from "../src/fetch/robots";
import { assertPublicUrl, isInternalAddress } from "../src/fetch/ssrf";
import { createCircuitBreaker } from "../src/libs/circuitBreaker";
import { parseRetryAfter, withRetry } from "../src/libs/retry";

describe("ssrf guard", () => {
  test.each([
    ["127.0.0.1", true],
    ["10.1.2.3", true],
    ["172.20.0.1", true],
    ["192.168.1.1", true],
    ["169.254.169.254", true],
    ["100.64.0.1", true],
    ["::1", true],
    ["fd00::1", true],
    ["fe80::1", true],
    ["::ffff:10.0.0.1", true],
    // IPv4 hidden in IPv6, in the forms URL parsers produce ([::ffff:169.254.169.254] → ::ffff:a9fe:a9fe)
    ["::ffff:a9fe:a9fe", true],
    ["::ffff:7f00:1", true],
    ["::7f00:1", true],
    ["64:ff9b::a9fe:a9fe", true],
    ["2002:7f00:1::", true],
    ["ff02::1", true],
    ["not-an-address", true],
    ["8.8.8.8", false],
    ["::ffff:8.8.8.8", false],
    ["64:ff9b::808:808", false],
    ["2606:4700::1111", false],
  ])("%s internal=%p", (address, internal) => {
    expect(isInternalAddress(address)).toBe(internal);
  });

  test("rejects non-http schemes and internal hosts", async () => {
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow("Unsupported scheme");
    await expect(assertPublicUrl("http://127.0.0.1:3000/x")).rejects.toThrow("internal address");
    await expect(assertPublicUrl("http://localhost/x")).rejects.toThrow("internal address");
  });

  test("accepts a public IP literal without DNS", async () => {
    expect((await assertPublicUrl("https://8.8.8.8/")).hostname).toBe("8.8.8.8");
  });
});

describe("robots.txt (RFC 9309)", () => {
  const robotsWith = (status: number, text = "") =>
    createRobots({ userAgent: "RUVO/0.1", fetchText: async () => ({ status, text }) });

  test("4xx means allow all", async () => {
    expect(await robotsWith(401).check("https://api.example.com/x")).toEqual({ allowed: true, crawlDelayMs: 0 });
  });

  test("5xx means disallow all", async () => {
    expect((await robotsWith(503).check("https://example.com/x")).allowed).toBe(false);
  });

  test("applies disallow rules and crawl-delay", async () => {
    const robots = robotsWith(200, "User-agent: *\nDisallow: /private\nCrawl-delay: 1\n");
    expect(await robots.check("https://example.com/private/a")).toEqual({ allowed: false, crawlDelayMs: 1000 });
    expect((await robots.check("https://example.com/public")).allowed).toBe(true);
  });
});

describe("host limiter", () => {
  test("caps concurrency per host", async () => {
    const limiter = createHostLimiter({ maxConcurrent: 2, minDelayMs: 0 });
    let active = 0;
    let peak = 0;
    const task = () =>
      limiter.run("a.com", 0, async () => {
        peak = Math.max(peak, ++active);
        await Bun.sleep(20);
        active--;
      });
    await Promise.all([task(), task(), task(), task()]);
    expect(peak).toBe(2);
  });

  test("spaces request starts by the crawl delay", async () => {
    const limiter = createHostLimiter({ maxConcurrent: 5, minDelayMs: 0 });
    const starts: number[] = [];
    await Promise.all([1, 2, 3].map(() => limiter.run("b.com", 40, async () => void starts.push(Date.now()))));
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(35);
    expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(35);
  });
});

describe("retry and circuit breaker", () => {
  const retryable = (e: unknown) => e instanceof FetchError && e.retryable;

  test("parses Retry-After seconds and dates", () => {
    expect(parseRetryAfter("3")).toBe(3000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(parseRetryAfter(null)).toBeUndefined();
  });

  test("retries transient errors until success", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        if (++calls < 3) throw new FetchError("http_status", "busy", { url: "u", status: 503 });
        return "ok";
      },
      { retries: 2, baseMs: 1, maxDelayMs: 5, shouldRetry: retryable },
    );
    expect([result, calls]).toEqual(["ok", 3]);
  });

  test("does not retry permanent errors", async () => {
    let calls = 0;
    const gone = new FetchError("http_status", "gone", { url: "u", status: 404 });
    const attempt = async () => {
      calls++;
      throw gone;
    };
    await expect(withRetry(attempt, { retries: 2, baseMs: 1, maxDelayMs: 5, shouldRetry: retryable })).rejects.toBe(gone);
    expect(calls).toBe(1);
  });

  test("opens after repeated failures and closes after the cooldown", () => {
    let now = 0;
    const breaker = createCircuitBreaker({ threshold: 2, cooldownMs: 100, now: () => now });
    breaker.recordFailure("h");
    expect(breaker.isOpen("h")).toBe(false);
    breaker.recordFailure("h");
    expect(breaker.isOpen("h")).toBe(true);
    now = 101;
    expect(breaker.isOpen("h")).toBe(false);
  });
});
