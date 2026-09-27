import robotsParser from "robots-parser";

type RobotsRules = { isAllowed(url: string): boolean; crawlDelayMs: number };

const ALLOW_ALL: RobotsRules = { isAllowed: () => true, crawlDelayMs: 0 };
const DENY_ALL: RobotsRules = { isAllowed: () => false, crawlDelayMs: 0 };
const CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * robots.txt handling per RFC 9309: a 4xx response (including 401/403) means no rules,
 * so everything is allowed; a 5xx or network failure means the site is unreachable,
 * so we assume a complete disallow. Rules are cached per origin for an hour.
 */
export function createRobots(opts: { userAgent: string; fetchText?: (url: string) => Promise<{ status: number; text: string }> }) {
  const fetchText =
    opts.fetchText ??
    (async (url: string) => {
      const res = await fetch(url, { headers: { "user-agent": opts.userAgent }, signal: AbortSignal.timeout(5000) });
      return { status: res.status, text: res.ok ? await res.text() : "" };
    });
  const cache = new Map<string, { rules: RobotsRules; expiresAt: number }>();

  async function rulesFor(url: URL): Promise<RobotsRules> {
    const cached = cache.get(url.origin);
    if (cached && cached.expiresAt > Date.now()) return cached.rules;

    const robotsUrl = `${url.origin}/robots.txt`;
    let rules: RobotsRules;
    try {
      const { status, text } = await fetchText(robotsUrl);
      if (status >= 500) rules = DENY_ALL;
      else if (status >= 400) rules = ALLOW_ALL;
      else {
        const parsed = robotsParser(robotsUrl, text);
        rules = {
          isAllowed: (target) => parsed.isAllowed(target, opts.userAgent) !== false,
          crawlDelayMs: (parsed.getCrawlDelay(opts.userAgent) ?? 0) * 1000,
        };
      }
    } catch {
      rules = DENY_ALL;
    }
    cache.set(url.origin, { rules, expiresAt: Date.now() + CACHE_TTL_MS });
    return rules;
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
