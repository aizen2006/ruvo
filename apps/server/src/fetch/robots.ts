import robotsParser from "robots-parser";
import { readCapped } from "./readCapped";
import { STEALTH_TIMEOUT_MS, type ScraplingClient } from "./scrapling";
import { resolvesInternally } from "./ssrf";
import { hasChallengeMarkers, isBotChallenge } from "./sufficiency";

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
 * (an unreachable verdict for two minutes). A robots.txt behind a bot check is read
 * with Scrapling's stealth browser, so the rules behind it still apply.
 */
export function createRobots(opts: {
  userAgent: string;
  fetchText?: (url: string) => Promise<{ status: number; text: string }>;
  /** Reads a robots.txt past the bot check in front of it (lib.rs has one). */
  scrapling?: ScraplingClient;
}) {
  const fetchText =
    opts.fetchText ??
    (async (url: string) => {
      // Redirects are followed by hand (up to 5, per RFC 9309) so none can lead to an internal address.
      let target = url;
      for (let hop = 0; hop <= 5; hop++) {
        const res = await fetch(target, { headers: { "user-agent": opts.userAgent }, redirect: "manual", signal: AbortSignal.timeout(5000) });
        const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
        // An error's body is not read, so a bot check is known here by its cf-mitigated header.
        if (!location && opts.scrapling && isBotChallenge(res.status, Object.fromEntries(res.headers), "")) return readPastBotCheck(opts.scrapling, target);
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

/** robots.txt read with the stealth browser. Nothing cancels a robots check, so the read has its own deadline. */
async function readPastBotCheck(scrapling: ScraplingClient, url: string) {
  const page = await scrapling.fetch(
    { url, engine: "stealth", timeoutMs: STEALTH_TIMEOUT_MS, maxBytes: MAX_ROBOTS_BYTES },
    AbortSignal.timeout(STEALTH_TIMEOUT_MS),
  );
  // Still behind the bot check, the rules were never seen: unreachable, not a 4xx or a rule-less page that allows everything.
  if (page.status >= 400 || hasChallengeMarkers(page.body)) throw new Error(`${url} still shows a bot check (HTTP ${page.status})`);
  return { status: page.status, text: page.body };
}
