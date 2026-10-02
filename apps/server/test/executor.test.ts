import { beforeEach, describe, expect, test } from "bun:test";
import type { DatasetContract, QualityReport, SourceBranch } from "@repo/contracts";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { evidence, records, runEvents, runs } from "../src/db/schema";
import { toCandidate, type Candidate } from "../src/execute/candidate";
import { executeWorkflow, type FindMore } from "../src/execute/executor";
import { describeMatch, match } from "../src/execute/steps/match";
import { validate } from "../src/execute/steps/validate";
import { DEMO_CONTRACT } from "../src/plan/demoContract";
import type { RegistryCompany } from "../src/plan/registry";
import { buildTemplateIr } from "../src/plan/templates";
import { createRunContext } from "../src/runs/runContext";
import { insertRun, resetDb } from "./helpers/db";
import { createDecider } from "../src/decide/decider";
import { fakeLlm } from "./helpers/fakeLlm";
import { fixtureFetcher } from "./helpers/fixtures";
import type { Fetcher, FetchScope } from "../src/fetch/fetcher";

beforeEach(resetDb);

const offDecider = createDecider({ provider: null, mode: "off" });

const company = (name: string, ats: RegistryCompany["ats"], slug: string, tags: string[]): RegistryCompany => ({
  id: crypto.randomUUID(),
  name,
  ats,
  slug,
  tags,
  boardUrl: null, origin: "curated",
  jobCount: null,
  verifiedAt: null,
});

const budgets = { maxPages: 50, maxBrowserPages: 0, maxLlmCalls: 0, maxDurationMs: 60_000, maxRecords: 500 };

async function runWith(companies: RegistryCompany[], contract: DatasetContract = DEMO_CONTRACT, limits = budgets, slow = false, findMore?: FindMore) {
  const run = await insertRun({ status: "running" });
  const ir = buildTemplateIr(contract, companies, { budgets: limits, maxItemsPerSource: 40 });
  const { fetcher: fixtures } = fixtureFetcher({ "greenhouse.io": "greenhouse", "ashbyhq.com": "ashby", "lever.co": "lever" });
  const fetcher = slow ? neverAnswers : fixtures;
  const ctx = await createRunContext({ runId: run.id, signal: new AbortController().signal, contract, ir, fetcher, llm: fakeLlm(), decider: offDecider });
  await executeWorkflow(ctx, findMore);
  await ctx.dispose();
  return { run, ctx };
}

/** A source that never answers until the request is aborted. */
const hang = (scope: FetchScope): Promise<never> =>
  new Promise((_, reject) => scope.signal.addEventListener("abort", () => reject(scope.signal.reason), { once: true }));
const neverAnswers: Fetcher = { fetch: (scope) => hang(scope), json: (scope) => hang(scope) };

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
    // company is DERIVED from the registry (0.85), the weakest required field
    expect(rows[0]!.confidence).toBe(0.85);
    expect(ctx.metrics.snapshot()).toMatchObject({ rawRecords: 2, validRecords: 2 });
  });

  test("a failing source is reported and the others still complete", async () => {
    const { run } = await runWith([company("Missing Co", "workable", "missing", []), company("OpenAI", "ashby", "openai", ["ai_lab"])]);
    expect((await recordsOf(run.id)).length).toBe(2);
    const events = await db.select().from(runEvents).where(eq(runEvents.runId, run.id));
    expect(events.find((e) => e.type === "source.failed")?.message).toContain("Missing Co could not be collected");
  });

  test("the run time limit stops slow work without failing the run", async () => {
    const { run } = await runWith([company("OpenAI", "ashby", "openai", ["ai_lab"])], DEMO_CONTRACT, { ...budgets, maxDurationMs: 50 }, true);
    const events = await db.select().from(runEvents).where(eq(runEvents.runId, run.id));
    expect(events.find((e) => e.type === "source.time_limit")?.message).toContain("time limit was reached");
    expect(events.some((e) => e.type === "source.failed")).toBe(false);
  });

  test("fails the run when every source fails", async () => {
    await expect(runWith([company("Missing Co", "workable", "missing", [])])).rejects.toThrow("Missing Co could not be collected");
  });

  test("re-executing a run upserts instead of duplicating", async () => {
    const run = await insertRun({ status: "running" });
    const ir = buildTemplateIr(DEMO_CONTRACT, [company("OpenAI", "ashby", "openai", [])], { budgets, maxItemsPerSource: 40 });
    for (let attempt = 0; attempt < 2; attempt++) {
      const { fetcher } = fixtureFetcher({ "ashbyhq.com": "ashby" });
      const ctx = await createRunContext({ runId: run.id, signal: new AbortController().signal, contract: DEMO_CONTRACT, ir, fetcher, llm: fakeLlm(), decider: offDecider });
      await executeWorkflow(ctx);
      await ctx.dispose();
    }
    expect((await recordsOf(run.id)).length).toBe(2);
  });
});

describe("looking for more leads", () => {
  const openai = company("OpenAI", "ashby", "openai", ["ai_lab"]);
  /** The branch for one more company's board, as a FindMore would return it. Every Ashby board serves the fixture's 2 good leads. */
  const board = (name: string, ats: RegistryCompany["ats"] = "ashby") =>
    buildTemplateIr(DEMO_CONTRACT, [company(name, ats, name.toLowerCase(), ["ai_lab"])], { budgets, maxItemsPerSource: 40 }).sources;

  /** Hands out `rounds` in turn (an Error is thrown) and records each round it was asked for. */
  function fakeMore(...rounds: Array<SourceBranch[] | Error>) {
    const asked: number[] = [];
    const findMore: FindMore = async (_ctx, round) => {
      asked.push(round);
      const next = rounds.shift() ?? [];
      if (next instanceof Error) throw next;
      return next;
    };
    return Object.assign(findMore, { asked });
  }

  /** OpenAI's board (2 good leads in the fixture), then whatever `findMore` finds. */
  const runMore = (findMore: FindMore, { maxRecords = 500, maxDurationMs = 60_000, slow = false } = {}) =>
    runWith([openai], { ...DEMO_CONTRACT, maxRecords }, { ...budgets, maxDurationMs }, slow, findMore);

  const moreEvents = async (runId: string) =>
    (await db.select().from(runEvents).where(eq(runEvents.runId, runId)).orderBy(runEvents.seq)).filter((e) => e.type.startsWith("more."));

  test("a run short of leads reads the sources each round finds, for at most two extra rounds", async () => {
    const more = fakeMore(board("Perplexity"), board("Cohere"), board("Mistral"));
    const { run } = await runMore(more);

    expect(more.asked).toEqual([2, 3]);
    expect((await moreEvents(run.id)).map((e) => e.message)).toEqual([
      "Only 2 good leads so far; looking for more (round 2)",
      "Round 2 added 2 good leads",
      "Only 4 good leads so far; looking for more (round 3)",
      "Round 3 added 2 good leads",
    ]);
    // Dedupe, the quality report and the summary run once, over every source read.
    const [{ report }] = (await db.select({ report: runs.qualityReport }).from(runs).where(eq(runs.id, run.id))) as [{ report: QualityReport }];
    expect(report.bySource.map((s) => s.label).sort()).toEqual(["Cohere", "OpenAI", "Perplexity"]);
    const summary = (await db.select().from(runEvents).where(eq(runEvents.runId, run.id))).find((e) => e.type === "run.summary");
    expect(summary?.message).toBe("2 valid, 0 incomplete, 0 rejected, 4 duplicates, from 3 sources");
  });

  test("a run that already has enough leads does not look for more", async () => {
    const more = fakeMore(board("Perplexity"));
    const { run } = await runMore(more, { maxRecords: 2 });
    expect(more.asked).toEqual([]);
    expect(await moreEvents(run.id)).toEqual([]);
  });

  test("no round starts once less than a third of the time limit is left", async () => {
    const more = fakeMore(board("Perplexity"));
    await runMore(more, { maxDurationMs: 50, slow: true });
    expect(more.asked).toEqual([]);
  });

  test("a round that finds no new source ends the rounds", async () => {
    const more = fakeMore([], board("Perplexity"));
    await runMore(more);
    expect(more.asked).toEqual([2]);
  });

  test("failing to look for more ends the rounds with a warning, not the run", async () => {
    const more = fakeMore(new Error("SearXNG did not answer"), board("Perplexity"));
    const { run } = await runMore(more);
    expect(more.asked).toEqual([2]);
    expect((await moreEvents(run.id)).at(-1)).toMatchObject({ level: "warn", message: "Stopped looking for more leads: SearXNG did not answer" });
    expect((await recordsOf(run.id)).length).toBe(2);
  });

  test("sources from later rounds count towards the run failing when none could be collected", async () => {
    const more = fakeMore(board("Missing Co", "workable"));
    await expect(runWith([company("Gone Co", "workable", "gone", [])], DEMO_CONTRACT, budgets, false, more)).rejects.toThrow(
      "None of the 2 sources could be collected",
    );
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

  test("companies without registry tags are undecided on company criteria, not rejected", async () => {
    const hardTags = { ...DEMO_CONTRACT, criteria: DEMO_CONTRACT.criteria.map((c) => (c.kind === "company_tag" ? { ...c, strength: "hard" as const } : c)) };
    const [unknown, tagged] = await match({ contract: hardTags } as never, {} as never, matchStep, [
      candidate({ ...base, title: "Backend Engineer" }, []),
      candidate({ ...base, title: "Backend Engineer" }, ["fintech"]),
    ]);
    expect(unknown!.signals.find((s) => s.criterionId === "good_company")?.passed).toBeNull();
    expect(unknown!.rejectReasons).toEqual([]);
    expect(tagged!.rejectReasons).toEqual(["AI / infra / devtools company: not met"]);
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

  test("an unverified required value counts as missing and confidence is the weakest required field", async () => {
    const c = candidate({ ...base, title: "Backend Engineer" });
    c.item.fields.location!.evidence = { ...c.item.fields.location!.evidence, method: "LLM", verified: false };
    const [unverified] = await validate(ctx, {} as never, validateStep, [c]);
    expect(unverified!.status).toBe("incomplete");
    expect(unverified!.rejectReasons).toEqual(["Missing required field: location"]);

    c.item.fields.location!.evidence = { ...c.item.fields.location!.evidence, method: "REGEX", verified: true };
    const [regex] = await validate(ctx, {} as never, validateStep, [c]);
    expect(regex!.status).toBe("valid");
    expect(regex!.confidence).toBe(0.8);
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
