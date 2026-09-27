/**
 * Captures real pages into test/fixtures/html/ for PageState and recipe tests:
 * `bun scripts/capture-html-fixtures.ts`. Styles, SVG and scripts without data are
 * stripped so fixtures stay small; data scripts (JSON-LD, embedded state) are kept.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const OUT = new URL("../test/fixtures/html/", import.meta.url);
const UA = "RUVO/0.1 (+https://github.com/aizen2006/ruvo)";
const DATA_SCRIPT = /application\/ld\+json|__NEXT_DATA__|__appData|__remixContext/;
/**
 * Client-side keys that sites embed in their pages (e.g. Greenhouse's Google Picker key).
 * They are public, but committing them trips secret scanners, so fixtures get a placeholder.
 */
const EMBEDDED_KEYS = /AIza[0-9A-Za-z_-]{35}|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{36}/g;

function trim(html: string): string {
  return html
    .replace(EMBEDDED_KEYS, "REDACTED_KEY")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<link[^>]*>/gi, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (tag) => (DATA_SCRIPT.test(tag) ? tag : ""));
}

async function save(name: string, html: string) {
  await writeFile(new URL(`${name}.html`, OUT), trim(html));
  console.log(`saved ${name}.html (${Math.round(trim(html).length / 1024)} KB)`);
}

const http = async (url: string) => (await fetch(url, { headers: { "user-agent": UA } })).text();

await mkdir(OUT, { recursive: true });

// A Lever posting page (JSON-LD JobPosting).
const lever = (await (await fetch("https://api.lever.co/v0/postings/palantir?mode=json&limit=1")).json()) as Array<{ hostedUrl: string }>;
await save("lever-posting", await http(lever[0]!.hostedUrl));

// Ashby board (window.__appData) and Greenhouse job page (__remixContext).
await save("ashby-board", await http("https://jobs.ashbyhq.com/openai"));
const gh = (await (await fetch("https://boards-api.greenhouse.io/v1/boards/anthropic/jobs")).json()) as { jobs: Array<{ absolute_url: string }> };
await save("greenhouse-job", await http(gh.jobs[0]!.absolute_url));

// Workable board: an empty shell over HTTP, the real list only after rendering.
await save("workable-shell", await http("https://apply.workable.com/huggingface/"));
const browser = await chromium.launch();
const page = await browser.newPage({ userAgent: UA });
await page.goto("https://apply.workable.com/huggingface/", { waitUntil: "domcontentloaded" });
await page.waitForSelector("li[data-ui='job']", { timeout: 30_000 }).catch(() => page.waitForTimeout(8000));
await save("workable-rendered", await page.content());
await browser.close();
