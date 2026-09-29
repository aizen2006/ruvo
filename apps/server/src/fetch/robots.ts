import robotsParser from "robots-parser";
import { readCapped } from "./readCapped";
import { resolvesInternally } from "./ssrf";

type RobotsRules = { isAllowed(url: string): boolean; crawlDelayMs: number };

const ALLOW_ALL: RobotsRules = { isAllowed: () => true, crawlDelayMs: 0 };
const DENY_ALL: RobotsRules = { isAllowed: () => false, crawlDelayMs: 0 };
const CACHE_TTL_MS = 60 * 60 * 1000;
const UNREACHABLE_TTL_MS = 2 * 60 * 1000;
const MAX_CRAWL_DELAY_MS = 10_000;
const MAX_ROBOTS_BYTES = 500 * 1024;

/**
 * robots.txt handling per RFC 9309: a 4xx response (including 401/403) means no rules,
 * so everything is allowed; a 5xx or network failure means the site is unreachable,
 * so we assume a complete disallow. Rules are cached per origin for an hour
 * (an unreachable verdict for two minutes).
 */
export function createRobots(opts: { userAgent: string; fetchText?: (url: string) => Promise<{ status: number; text: string }> }) {
  const fetchText =
    opts.fetchText ??
    (async (url: string) => {
      // Redirects are followed by hand (up to 5, per RFC 9309) so none can lead to an internal address.
      let target = url;
      for (let hop = 0; hop <= 5; hop++) {
        const res = await fetch(target, { headers: { "user-agent": opts.userAgent }, redirect: "manual", signal: AbortSignal.timeout(5000) });
        const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
        if (!location) return { status: res.status, text: res.ok ? await readCapped(res, MAX_ROBOTS_BYTES, target) : "" };
        const next = new URL(location, target);
        if (next.origin !== new URL(url).origin && (await resolvesInternally(next.hostname))) break;
        target = next.href;
      }
      // Too many redirects, or one into a private network: treat robots.txt as unavailable.
      return { status: 404, text: "" };
    });
  const cache = new Map<string, { rules: RobotsRules; expiresAt: number }>();

  async function rulesFor(url: URL): Promise<RobotsRules> {
    const cached = cache.get(url.origin);
    if (cached && cached.expiresAt > Date.now()) return cached.rules;

    const robotsUrl = `${url.origin}/robots.txt`;
    // An unreachable robots.txt is retried once, then disallows only briefly so one blip can't block a host for long.
    const rules = (await load(robotsUrl)) ?? (await load(robotsUrl));
    cache.set(url.origin, { rules: rules ?? DENY_ALL, expiresAt: Date.now() + (rules ? CACHE_TTL_MS : UNREACHABLE_TTL_MS) });
    return rules ?? DENY_ALL;
  }

  /** The site's rules, or null if robots.txt is unreachable (5xx or network error). */
  async function load(robotsUrl: string): Promise<RobotsRules | null> {
    try {
      const { status, text } = await fetchText(robotsUrl);
      if (status >= 500) return null;
      if (status >= 400) return ALLOW_ALL;
      const parsed = robotsParser(robotsUrl, text);
      return {
        isAllowed: (target) => parsed.isAllowed(target, opts.userAgent) !== false,
        // Honoured up to a cap: an hour-long Crawl-delay would stall the shared worker.
        crawlDelayMs: Math.min((parsed.getCrawlDelay(opts.userAgent) ?? 0) * 1000, MAX_CRAWL_DELAY_MS),
      };
    } catch {
      return null;
    }
  }

  return {
    async check(rawUrl: string): Promise<{ allowed: boolean; crawlDelayMs: number }> {
      const url = new URL(rawUrl);
      const rules = await rulesFor(url);
      return { allowed: rules.isAllowed(url.href), crawlDelayMs: rules.crawlDelayMs };
    },
  };
}

export type Robots = ReturnType<typeof createRobots>;
