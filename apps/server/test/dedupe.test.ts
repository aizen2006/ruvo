import { beforeEach, describe, expect, test } from "bun:test";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../src/db/client";
import { records } from "../src/db/schema";
import { clusterDuplicates, normalizeText, recordKeys, type DedupeCandidate } from "../src/execute/dedupe";
import { executeWorkflow } from "../src/execute/executor";
import { DEMO_CONTRACT } from "../src/plan/demoContract";
import type { RegistryCompany } from "../src/plan/registry";
import { buildTemplateIr } from "../src/plan/templates";
import { createRunContext } from "../src/runs/runContext";
import { insertRun, resetDb } from "./helpers/db";
import { createDecider } from "../src/decide/decider";
import { fakeLlm } from "./helpers/fakeLlm";
import { fixtureFetcher } from "./helpers/fixtures";

const specs = DEMO_CONTRACT.dedupKeys; // [["url"], ["company","title","location"]]

describe("recordKeys", () => {
  test("normalizes URLs, companies, titles and locations", () => {
    const a = recordKeys(DEMO_CONTRACT, { url: "https://boards.greenhouse.io/x/jobs/1?gh_src=li", company: "Acme, Inc.", title: "Sr. Backend Engineer", location: "San Francisco, CA" }, specs);
    const b = recordKeys(DEMO_CONTRACT, { url: "https://job-boards.greenhouse.io/x/jobs/1", company: "ACME", title: "Senior Backend Engineer", location: "San Francisco" }, specs);
    expect(a).toEqual(b);
  });

  test("a key with a missing part is empty", () => {
    expect(recordKeys(DEMO_CONTRACT, { url: null, company: "Acme", title: "Engineer", location: null }, specs)).toEqual(["", ""]);
  });

  test("normalizeText", () => {
    expect(normalizeText("R&D Engineer — Sr.")).toBe("r and d engineer senior");
  });
});

describe("clusterDuplicates", () => {
  const rec = (id: string, keys: string[], extra: Partial<DedupeCandidate> = {}): DedupeCandidate => ({
    id,
    keys,
    methodRank: 0,
    confidence: 0.9,
    completeness: 5,
    createdAt: 0,
    ...extra,
  });

  test("links records that share any key, transitively", () => {
    const clusters = clusterDuplicates([rec("a", ["u1", "f1"]), rec("b", ["u2", "f1"]), rec("c", ["u2", ""]), rec("d", ["u9", "f9"])]);
    expect([...clusters.entries()]).toEqual([["a", ["b", "c"]]]);
  });

  test("keeps the record with the best evidence, then confidence, then completeness", () => {
    const keeperOf = (records: DedupeCandidate[]) => [...clusterDuplicates(records).keys()][0];
    expect(keeperOf([rec("llm", ["k"], { methodRank: 5 }), rec("api", ["k"], { methodRank: 0 })])).toBe("api");
    expect(keeperOf([rec("low", ["k"], { confidence: 0.5 }), rec("high", ["k"], { confidence: 0.99 })])).toBe("high");
    expect(keeperOf([rec("sparse", ["k"], { completeness: 2 }), rec("full", ["k"], { completeness: 8 })])).toBe("full");
  });

  test("empty keys never match", () => {
    expect(clusterDuplicates([rec("a", ["", ""]), rec("b", ["", ""])]).size).toBe(0);
  });
});

describe("dedupeRun", () => {
  beforeEach(resetDb);

const offDecider = createDecider({ provider: null, mode: "off" });

  test("the same board collected twice yields one set of records seen on both sources", async () => {
    const run = await insertRun({ status: "running" });
    const openai = { id: crypto.randomUUID(), name: "OpenAI", ats: "ashby", slug: "openai", tags: [], origin: "curated", jobCount: null, verifiedAt: null } satisfies RegistryCompany;
    const ir = buildTemplateIr(DEMO_CONTRACT, [openai], {
      budgets: { maxPages: 10, maxBrowserPages: 0, maxLlmCalls: 0, maxDurationMs: 60_000, maxRecords: 100 },
      maxItemsPerSource: 40,
    });
    // A second branch over the same board, as if a job board mirrored the company's postings.
    const mirror = structuredClone(ir.sources[0]!);
    mirror.id = "src_mirror";
    mirror.label = "Mirror board";
    ir.sources.push(mirror);

    const { fetcher } = fixtureFetcher({ "ashbyhq.com": "ashby" });
    const ctx = await createRunContext({ runId: run.id, signal: new AbortController().signal, contract: DEMO_CONTRACT, ir, fetcher, llm: fakeLlm(), decider: offDecider });
    await executeWorkflow(ctx);
    await ctx.dispose();

    const kept = await db.select().from(records).where(and(eq(records.runId, run.id), isNull(records.duplicateOf)));
    expect(kept).toHaveLength(2);
    expect(kept.every((r) => r.seenOn.sort().join() === "Mirror board,OpenAI")).toBe(true);
    expect(kept.every((r) => r.canonicalKey?.startsWith("url:https://jobs.ashbyhq.com/openai/"))).toBe(true);
    expect(ctx.metrics.snapshot()).toMatchObject({ duplicates: 2, validRecords: 2 });
  });
});
