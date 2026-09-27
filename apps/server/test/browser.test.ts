import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createBrowserPool } from "../src/fetch/browser";
import { createFetcher, type FetchScope } from "../src/fetch/fetcher";
import { assessHtml } from "../src/fetch/sufficiency";
import { createBudget } from "../src/runs/budget";
import { createMetrics } from "../src/runs/metrics";
import { resetDb } from "./helpers/db";

const jobs = Array.from({ length: 12 }, (_, i) => `<li class="job"><a href="/jobs/${i}">Backend Engineer ${i}</a><span>Remote</span></li>`).join("");
const staticPage = `<html><body><h1>Careers</h1><ul>${jobs}</ul><p>${"We build infrastructure. ".repeat(40)}</p></body></html>`;
const appShell = `<html><body><div id="root"></div><script>
  setTimeout(() => { document.getElementById("root").innerHTML = '<h1>Careers</h1><ul>${jobs}</ul><p>${"We build infrastructure. ".repeat(40)}</p>'; }, 300);
</script></body></html>`;

const site = Bun.serve({
  port: 0,
  fetch(req) {
    const path = new URL(req.url).pathname;
    const body = path === "/static" ? staticPage : path === "/app" ? appShell : null;
    return body ? new Response(body, { headers: { "content-type": "text/html" } }) : new Response("missing", { status: 404 });
  },
});
const base = `http://localhost:${site.port}`;
// Launching Chromium and rendering takes a few seconds.
const BROWSER_TIMEOUT = 30_000;
const pool = createBrowserPool({ userAgent: "RUVO-test", allowPrivateNetwork: true });
afterAll(async () => {
  site.stop();
  await pool.close();
});
beforeEach(resetDb);

const scope = (browserPages = 5): FetchScope => ({
  signal: new AbortController().signal,
  budget: createBudget({ maxPages: 20, maxBrowserPages: browserPages, maxLlmCalls: 0, maxDurationMs: 60_000, maxRecords: 1 }),
  metrics: createMetrics(),
});

describe("assessHtml", () => {
  test("a server-rendered page is sufficient", () => {
    expect(assessHtml(staticPage).sufficient).toBe(true);
  });

  test("an empty app shell needs a browser", () => {
    expect(assessHtml(appShell)).toMatchObject({ sufficient: false, reason: expect.stringContaining("characters of text") });
  });
});

describe("auto fetch", () => {
  const fetcher = createFetcher({ userAgent: "RUVO-test", cacheMode: "ttl", allowPrivateNetwork: true, browser: pool });

  test("keeps plain HTTP when the page already has its content", async () => {
    const s = scope();
    const page = await fetcher.fetch(s, { url: `${base}/static`, expect: "html", purpose: "t", mode: "auto" });
    expect(page).toMatchObject({ via: "http", escalation: null });
    expect(s.metrics.snapshot().browserPages).toBe(0);
  });

  test("renders JavaScript pages in the browser and says why", async () => {
    const s = scope();
    const page = await fetcher.fetch(s, { url: `${base}/app`, expect: "html", purpose: "t", mode: "auto" });
    expect(page.via).toBe("browser");
    expect(page.escalation?.reason).toContain("characters of text");
    expect(page.body).toContain("Backend Engineer 11");
    expect(s.metrics.snapshot()).toMatchObject({ browserPages: 1, pagesVisited: 2 });

    // The rendered copy is reused instead of rendering again.
    const again = await fetcher.fetch(scope(), { url: `${base}/app`, expect: "html", purpose: "t", mode: "auto" });
    expect(again).toMatchObject({ via: "browser", fromCache: true });
  }, BROWSER_TIMEOUT);

  test("respects the browser page budget", async () => {
    const error = await fetcher.fetch(scope(0), { url: `${base}/app`, expect: "html", purpose: "t", mode: "browser" }).catch((e) => e);
    expect(error.kind).toBe("budget_exhausted");
  });
});
