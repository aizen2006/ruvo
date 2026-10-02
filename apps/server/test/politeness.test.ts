import { afterAll, describe, expect, setSystemTime, test } from "bun:test";
import { FetchError } from "../src/fetch/errors";
import { createHostLimiter } from "../src/fetch/hostLimiter";
import { createRobots } from "../src/fetch/robots";
import type { ScraplingClient } from "../src/fetch/scrapling";
import { assertPublicUrl, isInternalAddress, publicAddresses } from "../src/fetch/ssrf";
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
    ["198.18.0.1", true],
    ["198.19.255.255", true],
    ["192.0.0.8", true],
    ["64:ff9b:1::808:808", true],
    ["::ffff:0:808:808", true],
    ["2001::1", true],
    ["2001:0:4136:e378:8000:63bf:3fff:fdd2", true],
    ["fec0::1", true],
    ["not-an-address", true],
    ["8.8.8.8", false],
    ["198.20.0.1", false],
    ["192.0.1.1", false],
    ["::ffff:8.8.8.8", false],
    ["64:ff9b::808:808", false],
    ["2001:4860:4860::8888", false],
    ["2606:4700::1111", false],
  ])("%s internal=%p", (address, internal) => {
    expect(isInternalAddress(address)).toBe(internal);
  });

  test("checks IP literals without DNS, bracketed IPv6 too", async () => {
    expect(await publicAddresses("8.8.8.8")).toEqual([{ address: "8.8.8.8", family: 4 }]);
    expect(await publicAddresses("[2606:4700::1111]")).toEqual([{ address: "2606:4700::1111", family: 6 }]);
    await expect(publicAddresses("10.0.0.1")).rejects.toMatchObject({ kind: "ssrf_blocked" });
    await expect(publicAddresses("[::1]")).rejects.toMatchObject({ kind: "ssrf_blocked" });
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

  test("an unreachable robots.txt is retried once, and disallows for two minutes only", async () => {
    const statuses = [503, 200, 503, 503, 200];
    const robots = createRobots({ userAgent: "RUVO/0.1", fetchText: async () => ({ status: statuses.shift()!, text: "" }) });
    expect((await robots.check("https://a.example.com/x")).allowed).toBe(true);
    try {
      setSystemTime(new Date("2026-01-01T00:00:00Z"));
      expect((await robots.check("https://b.example.com/x")).allowed).toBe(false);
      setSystemTime(new Date("2026-01-01T00:02:01Z"));
      expect((await robots.check("https://b.example.com/x")).allowed).toBe(true);
    } finally {
      setSystemTime();
    }
  });

  test("a robots.txt over 500 KiB is not read", async () => {
    let body = "User-agent: *\nAllow: /\n";
    using server = Bun.serve({ port: 0, fetch: () => new Response(body) });
    const url = `http://127.0.0.1:${server.port}/x`;
    expect((await createRobots({ userAgent: "RUVO/0.1" }).check(url)).allowed).toBe(true);
    body += `# ${"x".repeat(600 * 1024)}\n`;
    expect((await createRobots({ userAgent: "RUVO/0.1" }).check(url)).allowed).toBe(false);
  });

  test("applies disallow rules and crawl-delay", async () => {
    const robots = robotsWith(200, "User-agent: *\nDisallow: /private\nCrawl-delay: 1\n");
    expect(await robots.check("https://example.com/private/a")).toEqual({ allowed: false, crawlDelayMs: 1000 });
    expect((await robots.check("https://example.com/public")).allowed).toBe(true);
  });

  describe("behind a bot check", () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("Just a moment...", { status: 403, headers: { "cf-mitigated": "challenge" } }) });
    const base = `http://127.0.0.1:${server.port}`;
    afterAll(() => server.stop());
    /** A fake Scrapling service that answers the stealth engine with `read`. */
    const stealthReading = (read: () => Promise<string>) => {
      const asked: string[] = [];
      const scrapling: ScraplingClient = {
        async fetch({ url, engine }) {
          asked.push(`${engine} ${url}`);
          return { status: 200, url, headers: {}, body: await read() };
        },
      };
      return { robots: createRobots({ userAgent: "RUVO/0.1", scrapling }), asked };
    };

    test("is read with the stealth browser, and its rules apply", async () => {
      const { robots, asked } = stealthReading(async () => "User-agent: *\nDisallow: /private\n");
      expect((await robots.check(`${base}/private/a`)).allowed).toBe(false);
      expect((await robots.check(`${base}/public`)).allowed).toBe(true);
      expect(asked).toEqual([`stealth ${base}/robots.txt`]);
    });

    test("disallows everything when the stealth read fails", async () => {
      const { robots } = stealthReading(async () => {
        throw new FetchError("network", "timed out", { url: base });
      });
      expect((await robots.check(`${base}/public`)).allowed).toBe(false);
    });
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

  // Bug: start slots are fixed when reserved, so a start that runs late (busy event loop) leaves the next one too close.
  test.todo("keeps the crawl delay after a start that ran late", async () => {
    const limiter = createHostLimiter({ maxConcurrent: 5, minDelayMs: 0 });
    const starts: number[] = [];
    const busy = (ms: number) => {
      const until = Date.now() + ms;
      while (Date.now() < until);
    };
    // The first task holds the thread past the second start's slot (40 ms), which therefore runs late.
    await Promise.all(
      [60, 0, 0].map((holdMs) =>
        limiter.run("c.com", 40, async () => {
          starts.push(Date.now());
          busy(holdMs);
        }),
      ),
    );
    expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(40);
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
