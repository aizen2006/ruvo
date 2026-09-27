import { beforeEach, describe, expect, test } from "bun:test";
import type { DatasetContract } from "@repo/contracts";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { evidence, records, runEvents } from "../src/db/schema";
import { toCandidate, type Candidate } from "../src/execute/candidate";
import { executeWorkflow } from "../src/execute/executor";
import { describeMatch, match } from "../src/execute/steps/match";
import { validate } from "../src/execute/steps/validate";
import { DEMO_CONTRACT } from "../src/plan/demoContract";
import type { RegistryCompany } from "../src/plan/registry";
import { buildTemplateIr } from "../src/plan/templates";
import { createRunContext } from "../src/runs/runContext";
import { insertRun, resetDb } from "./helpers/db";
import { fixtureFetcher } from "./helpers/fixtures";

beforeEach(resetDb);

const company = (name: string, ats: RegistryCompany["ats"], slug: string, tags: string[]): RegistryCompany => ({
  id: crypto.randomUUID(),
  name,
  ats,
  slug,
  tags,
  origin: "curated",
  jobCount: null,
  verifiedAt: null,
});

const budgets = { maxPages: 50, maxBrowserPages: 0, maxLlmCalls: 0, maxDurationMs: 60_000, maxRecords: 500 };

async function runWith(companies: RegistryCompany[], contract: DatasetContract = DEMO_CONTRACT) {
  const run = await insertRun({ status: "running" });
  const ir = buildTemplateIr(contract, companies, { budgets, maxItemsPerSource: 40 });
  const { fetcher } = fixtureFetcher({ "greenhouse.io": "greenhouse", "ashbyhq.com": "ashby", "lever.co": "lever" });
  const ctx = await createRunContext({ runId: run.id, signal: new AbortController().signal, contract, ir, fetcher });
  await executeWorkflow(ctx);
  await ctx.dispose();
  return { run, ctx };
}

const recordsOf = (runId: string) => db.select().from(records).where(eq(records.runId, runId));

describe("executeWorkflow", () => {
  test("collects, filters, matches, validates and stores records with evidence", async () => {
    const { run, ctx } = await runWith([company("OpenAI", "ashby", "openai", ["ai_lab"])]);
    const rows = await recordsOf(run.id);

    // The Ashby fixture holds 4 postings; the two "Research Engineer" roles pass the role keywords.
    expect(rows.map((r) => r.data.title).sort()).toEqual(["Research Engineer", "Research Engineer, Retrieval & Search, Applied Engineering"]);
    expect(rows.every((r) => r.status === "valid")).toBe(true);
    expect(rows[0]!.signals.find((s) => s.criterionId === "good_company")?.passed).toBe(true);

    const ev = await db.select().from(evidence).where(eq(evidence.recordId, rows[0]!.id));
    expect(ev.map((e) => e.field).sort()).toEqual(expect.arrayContaining(["company", "title", "url", "salary"]));
    expect(ev.find((e) => e.field === "title")).toMatchObject({ method: "API", verified: true, confidence: 0.99 });
    expect(ctx.metrics.snapshot()).toMatchObject({ rawRecords: 2, validRecords: 2 });
  });

  test("a failing source is reported and the others still complete", async () => {
    const { run } = await runWith([company("Missing Co", "workable", "missing", []), company("OpenAI", "ashby", "openai", ["ai_lab"])]);
    expect((await recordsOf(run.id)).length).toBe(2);
    const events = await db.select().from(runEvents).where(eq(runEvents.runId, run.id));
    expect(events.find((e) => e.type === "source.failed")?.message).toContain("Missing Co failed at collect");
  });

  test("fails the run when every source fails", async () => {
    await expect(runWith([company("Missing Co", "workable", "missing", [])])).rejects.toThrow("Every source failed");
  });

  test("re-executing a run upserts instead of duplicating", async () => {
    const run = await insertRun({ status: "running" });
    const ir = buildTemplateIr(DEMO_CONTRACT, [company("OpenAI", "ashby", "openai", [])], { budgets, maxItemsPerSource: 40 });
    for (let attempt = 0; attempt < 2; attempt++) {
      const { fetcher } = fixtureFetcher({ "ashbyhq.com": "ashby" });
      const ctx = await createRunContext({ runId: run.id, signal: new AbortController().signal, contract: DEMO_CONTRACT, ir, fetcher });
      await executeWorkflow(ctx);
      await ctx.dispose();
    }
    expect((await recordsOf(run.id)).length).toBe(2);
  });
});

describe("match and validate", () => {
  const candidate = (fields: Record<string, string>, tags: string[] = []): Candidate =>
    toCandidate("src", {
      externalId: crypto.randomUUID(),
      fields: Object.fromEntries(
        Object.entries(fields).map(([k, v]) => [
          k,
          { value: v, evidence: { method: "API", sourceUrl: "https://x.test", pageId: null, snippet: v, locator: { kind: "jsonPath", value: "$" }, verified: true } },
        ]),
      ),
      text: null,
      meta: { companyTags: tags },
    });

  const ctx = { contract: DEMO_CONTRACT } as Parameters<typeof match>[0];
  const matchStep = { id: "m", kind: "match" as const, criteria: DEMO_CONTRACT.criteria.map((c) => c.id) };
  const validateStep = { id: "v", kind: "validate" as const, required: ["company", "title", "location", "url"], requireEvidence: true as const };
  const base = { company: "Acme", location: "Remote", url: "https://acme.test/jobs/1" };

  test("hard criteria reject, soft criteria score", async () => {
    const [backend, frontend] = await match(ctx, {} as never, matchStep, [
      candidate({ ...base, title: "Senior Backend Engineer", remote: "remote" }, ["ai_lab"]),
      candidate({ ...base, title: "Frontend Engineer" }),
    ]);
    expect(backend!.rejectReasons).toEqual([]);
    // Both soft preferences (remote 0.5, company 0.3) are met: the full soft weight is earned.
    expect(backend!.matchScore).toBe(1);
    expect(frontend!.rejectReasons).toEqual([
      "Backend / AI engineering role: not met",
      "Not a non-engineering or frontend role: not met",
    ]);
  });

  test("partial soft matches score proportionally", async () => {
    const [onsite] = await match(ctx, {} as never, matchStep, [candidate({ ...base, title: "Backend Engineer", remote: "onsite" }, ["ai_lab"])]);
    expect(onsite!.matchScore).toBeCloseTo(0.3 / 0.8);
  });

  test("derives match_reason from the signals when the contract asks for it", async () => {
    const withReason = { ...DEMO_CONTRACT, fields: [...DEMO_CONTRACT.fields, { name: "why", catalogKey: "match_reason" as const, type: "string" as const, required: false, description: "" }] };
    const [c] = await match({ contract: withReason } as never, {} as never, matchStep, [candidate({ ...base, title: "Backend Engineer", remote: "onsite" }, ["ai_lab"])]);
    expect(c!.item.fields.why?.value).toBe(
      "Matches: Backend / AI engineering role; Not a non-engineering or frontend role; AI / infra / devtools company. Not confirmed: Remote.",
    );
    expect(c!.item.fields.why?.evidence).toMatchObject({ method: "DERIVED", locator: { value: "match signals" } });
  });

  test("describeMatch handles no confirmed criteria", () => {
    expect(describeMatch([])).toBe("No criteria confirmed.");
  });

  test("status reflects rejections and missing required fields", async () => {
    const [matched] = await match(ctx, {} as never, matchStep, [candidate({ ...base, title: "Backend Engineer" })]);
    const [ok] = await validate(ctx, {} as never, validateStep, [matched!]);
    expect(ok!.status).toBe("valid");

    const [noLocation] = await validate(ctx, {} as never, validateStep, [candidate({ company: "Acme", title: "Backend Engineer", url: "https://a.test" })]);
    expect(noLocation!.status).toBe("incomplete");
    expect(noLocation!.rejectReasons).toEqual(["Missing required field: location"]);
  });
});
