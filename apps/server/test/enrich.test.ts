import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Item } from "../src/adapters/types";
import { toCandidate } from "../src/execute/candidate";
import { enrich } from "../src/execute/steps/enrich";
import { jsonLdRung } from "../src/extract/rungs/jsonLd";
import type { Fetcher } from "../src/fetch/fetcher";
import { DEMO_CONTRACT } from "../src/plan/demoContract";
import { createBudget } from "../src/runs/budget";
import { createMetrics } from "../src/runs/metrics";
import type { RunContext } from "../src/runs/runContext";
import { resetDb } from "./helpers/db";
import { fakeLlm } from "./helpers/fakeLlm";

beforeEach(resetDb);

const leverHtml = readFileSync(new URL("./fixtures/html/lever-posting.html", import.meta.url), "utf8");
const POSTING = "https://jobs.lever.co/palantir/abc";

const pageFetcher = (requested: string[]): Fetcher => ({
  async fetch(_scope, req) {
    requested.push(req.url);
    return { pageId: null as unknown as string, url: req.url, finalUrl: req.url, status: 200, via: "http", fromCache: false, contentType: "text/html", body: leverHtml, escalation: null };
  },
  json: () => Promise.reject(new Error("not used")),
});

function context(fetcher: Fetcher) {
  const events: Array<{ type: string; message: string }> = [];
  const ctx = {
    runId: crypto.randomUUID(),
    signal: new AbortController().signal,
    contract: DEMO_CONTRACT,
    budget: createBudget({ maxPages: 10, maxBrowserPages: 0, maxLlmCalls: 0, maxDurationMs: 60_000, maxRecords: 10 }),
    metrics: createMetrics(),
    fetcher,
    llm: fakeLlm(),
    emit: (e: { type: string; message: string }) => events.push(e),
  } as unknown as RunContext;
  return { ctx, events };
}

const item = (fields: Record<string, string>, description: string | null): Item => ({
  externalId: crypto.randomUUID(),
  fields: Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [
      k,
      { value: v, evidence: { method: "API", sourceUrl: POSTING, pageId: null, snippet: v, locator: { kind: "jsonPath", value: "$" }, verified: true } },
    ]),
  ),
  text: description ? { plain: description, sourceUrl: POSTING, pageId: null } : null,
  meta: {},
});

describe("jsonLdRung", () => {
  test("reads a Lever posting's JobPosting JSON-LD", async () => {
    const fields = DEMO_CONTRACT.fields.filter((f) => ["title", "company", "location", "posted_at"].includes(f.name));
    const out = await jsonLdRung.fill({} as RunContext, fields, { text: "", html: leverHtml, sourceUrl: POSTING, pageId: null });
    expect(out.company).toMatchObject({ value: "Palantir Technologies", evidence: { method: "JSON_LD", locator: { value: "JobPosting.hiringOrganization.name" } } });
    expect(out.location?.value).toBe("Singapore, Singapore");
    expect(out.posted_at?.value).toBe("2026-08-11");
  });
});

describe("enrich step", () => {
  const step = { id: "e", kind: "enrich" as const, fields: ["salary", "posted_at"], rungs: ["regex" as const, "json_ld" as const], fetch: "http" as const, maxFetches: 1 };

  test("uses the description first, then the posting page, within the fetch allowance", async () => {
    const requested: string[] = [];
    const { ctx, events } = context(pageFetcher(requested));
    const [fromText, fromPage, untouched] = await enrich(ctx, { id: "b", label: "Palantir" } as never, step, [
      toCandidate("b", item({ title: "Backend Engineer", url: POSTING }, "The annual base salary range is $180,000—$250,000 USD.")),
      toCandidate("b", item({ title: "Platform Engineer", url: POSTING }, "No pay details here.")),
      toCandidate("b", item({ title: "Infra Engineer", url: POSTING }, "No pay details here either.")),
    ]);

    expect(fromText!.item.fields.salary).toMatchObject({ value: "USD 180,000–250,000 / year", evidence: { method: "REGEX" } });
    // The allowance of one page fetch was spent on the first record that still missed fields.
    expect(requested).toHaveLength(1);
    const fetchedOne = [fromText, fromPage, untouched].filter((c) => c!.item.fields.posted_at?.evidence.method === "JSON_LD");
    expect(fetchedOne).toHaveLength(1);
    expect(events.at(-1)?.type).toBe("enrich.completed");
  });
});
