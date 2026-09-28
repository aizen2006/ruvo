import { chromium, type Browser } from "playwright";
import { createSemaphore } from "../libs/limit";
import { resolvesInternally } from "./ssrf";

export interface RenderResult {
  html: string;
  finalUrl: string;
  status: number;
  textLength: number;
}

export interface BrowserPool {
  render(url: string, opts: { signal?: AbortSignal; timeoutMs?: number }): Promise<RenderResult>;
  close(): Promise<void>;
}

const BLOCKED_RESOURCES = new Set(["image", "font", "media"]);

/**
 * One headless Chromium shared by the process, launched on first use and relaunched if it
 * crashes. Each page gets its own browser context (no shared cookies or storage).
 * The pool only turns a URL into rendered HTML; extraction happens on that HTML elsewhere.
 */
export function createBrowserPool(opts: {
  userAgent: string;
  maxPages?: number;
  allowPrivateNetwork?: boolean;
  /** Origins the page may load even though they are local, e.g. RUVO's own demo site. */
  trustedOrigins?: string[];
}): BrowserPool {
  const trusted = new Set(opts.trustedOrigins ?? []);
  const limit = createSemaphore(opts.maxPages ?? 2);
  let browser: Promise<Browser> | null = null;

  const getBrowser = async () => {
    const current = browser ? await browser.catch(() => null) : null;
    if (current?.isConnected()) return current;
    browser = chromium.launch();
    return browser;
  };

  return {
    render: (url, { signal, timeoutMs = 20_000 }) =>
      limit(async () => {
        signal?.throwIfAborted();
        const context = await (await getBrowser()).newContext({ userAgent: opts.userAgent, javaScriptEnabled: true });
        const abort = () => void context.close().catch(() => {});
        signal?.addEventListener("abort", abort, { once: true });
        try {
          const page = await context.newPage();
          // Every request the page makes (navigations, redirects, scripts, XHR) must stay on the
          // public internet: a rendered page could otherwise reach localhost or cloud metadata.
          const verdicts = new Map<string, Promise<boolean>>();
          await page.route("**/*", async (route) => {
            const request = route.request();
            if (BLOCKED_RESOURCES.has(request.resourceType())) return route.abort();
            const target = new URL(request.url());
            if (opts.allowPrivateNetwork || trusted.has(target.origin)) return route.continue();
            if (target.protocol !== "http:" && target.protocol !== "https:") return route.abort();
            if (!verdicts.has(target.hostname)) verdicts.set(target.hostname, resolvesInternally(target.hostname));
            return (await verdicts.get(target.hostname)) ? route.abort("blockedbyclient") : route.continue();
          });

          const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
          const textLength = await waitForStableText(page, Math.min(10_000, timeoutMs));
          return { html: await page.content(), finalUrl: page.url(), status: response?.status() ?? 200, textLength };
        } finally {
          signal?.removeEventListener("abort", abort);
          await context.close().catch(() => {});
        }
      }),
    async close() {
      const current = browser ? await browser.catch(() => null) : null;
      await current?.close();
      browser = null;
    },
  };
}

/**
 * Waits until the page's visible text stops growing (two equal readings 500 ms apart),
 * which is faster and more reliable than waiting for the network to go idle.
 */
async function waitForStableText(page: import("playwright").Page, maxMs: number): Promise<number> {
  const deadline = Date.now() + maxMs;
  let previous = -1;
  let stableReadings = 0;
  for (;;) {
    // Evaluated inside the page, so it is passed as source text rather than server-side code.
    const length = Number(await page.evaluate("document.body ? document.body.innerText.length : 0").catch(() => 0));
    stableReadings = length === previous && length > 0 ? stableReadings + 1 : 0;
    previous = length;
    if (stableReadings >= 2 || Date.now() > deadline) return length;
    await page.waitForTimeout(500);
  }
}
