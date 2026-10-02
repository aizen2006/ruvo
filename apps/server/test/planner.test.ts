import { beforeEach, describe, expect, test } from "bun:test";
import type { PlanDraft } from "@repo/contracts";
import { createLlmClient } from "../src/llm/client";
import { DEMO_CONTRACT } from "../src/plan/demoContract";
import { registryCandidate } from "../src/plan/discovery";
import { compileIr } from "../src/plan/irCompiler";
import { planForContract } from "../src/plan/planner";
import type { RegistryCompany } from "../src/plan/registry";
import { resetDb } from "./helpers/db";
import { fakeLlm, fakeResponses } from "./helpers/fakeLlm";

const company = (name: string, ats: RegistryCompany["ats"], slug: string): RegistryCompany => ({
  id: crypto.randomUUID(),
  name,
  ats,
  slug,
  tags: ["ai_lab"],
  boardUrl: null, origin: "curated",
  jobCount: 100,
  verifiedAt: null,
});
const candidates = [company("Anthropic", "greenhouse", "anthropic"), company("OpenAI", "ashby", "openai")].map((c) => registryCandidate(c, "test"));
const caps = { maxPages: 50, maxBrowserPages: 5, maxLlmCalls: 20, maxDurationMs: 60_000, maxRecords: 300 };
const provenance = { plannedBy: "llm" as const, model: "gpt-6-sol", reusedFrom: null, parentVersion: null };

const draft = (overrides: Partial<PlanDraft> = {}): PlanDraft => ({
  sources: candidates.map((c) => ({ ref: c.ref, include: true, reason: `Use ${c.label}`, titleKeywords: [], fetchDetails: false, maxItems: 30 })),
  fieldStrategies: [],
  llmBudget: 10,
  rationale: "test",
  ...overrides,
});

describe("compileIr", () => {
  test("builds one branch per included source with the canonical step order", () => {
    const ir = compileIr(DEMO_CONTRACT, draft(), candidates, { caps, provenance });
    expect(ir.sources.map((s) => s.id)).toEqual(["src_greenhouse_anthropic", "src_ashby_openai"]);
    // Greenhouse has no salary field, so its branch enriches before scoring.
    expect(ir.sources[0]!.steps.map((s) => s.kind)).toEqual(["collect", "prefilter", "enrich", "match", "validate", "store"]);
    expect(ir.sources[1]!.steps.map((s) => s.kind)).toEqual(["collect", "prefilter", "match", "validate", "store"]);
    expect(ir.sources[0]!.reason).toBe("Use Anthropic");
    expect(ir.provenance.warnings).toEqual([]);
  });

  test("drops unknown and duplicate refs, falling back to all candidates if nothing is left", () => {
    const bad = draft({ sources: [{ ...draft().sources[0]!, ref: "lever:nope" }] });
    const ir = compileIr(DEMO_CONTRACT, bad, candidates, { caps, provenance });
    expect(ir.provenance.warnings[0]).toContain('unknown source "lever:nope"');
    expect(ir.sources).toHaveLength(2);
  });

  test("clamps budgets and per-source caps", () => {
    const greedy = draft({ llmBudget: 999, sources: draft().sources.map((s) => ({ ...s, maxItems: 5000 })) });
    const ir = compileIr({ ...DEMO_CONTRACT, maxRecords: 10_000 }, greedy, candidates, { caps, provenance });
    expect(ir.budgets.maxLlmCalls).toBe(20);
    expect(ir.budgets.maxRecords).toBe(300);
    const collect = ir.sources[0]!.steps[0]!;
    expect(collect.kind === "collect" && collect.maxItems).toBe(100);
  });

  test("relaxes required fields that no chosen source can provide", () => {
    const contract = {
      ...DEMO_CONTRACT,
      fields: [...DEMO_CONTRACT.fields, { name: "funding", catalogKey: "custom" as const, type: "string" as const, required: true, description: "" }],
    };
    const ir = compileIr(contract, draft(), candidates, { caps, provenance });
    const validate = ir.sources[0]!.steps.find((s) => s.kind === "validate");
    expect(validate?.kind === "validate" && validate.required).not.toContain("funding");
    expect(ir.provenance.warnings[0]).toContain('"funding" is required but no chosen source provides it');
  });

  test("keeps the prefilter without keyword criteria, so the per-source cap still applies", () => {
    const contract = { ...DEMO_CONTRACT, criteria: DEMO_CONTRACT.criteria.filter((c) => c.kind !== "keyword_any" && c.kind !== "keyword_none") };
    const ir = compileIr(contract, draft(), candidates, { caps, provenance });
    expect(ir.sources[0]!.steps.find((s) => s.kind === "prefilter")).toMatchObject({ keywordsAny: [], keywordsNone: [] });
  });

  test("adds the planner's extra title keywords to the prefilter", () => {
    const ir = compileIr(DEMO_CONTRACT, draft({ sources: [{ ...draft().sources[0]!, titleKeywords: ["mts"] }] }), candidates, { caps, provenance });
    const prefilter = ir.sources[0]!.steps.find((s) => s.kind === "prefilter");
    expect(prefilter?.kind === "prefilter" && prefilter.keywordsAny).toContain("mts");
  });
});

describe("planForContract", () => {
  beforeEach(resetDb);
  const env = { MODEL_PLANNER: "gpt-6-sol", MODEL_WORKER: "gpt-6-luna", LLM_CACHE_MODE: "off" as const, OPENAI_API_KEY: "x" };

  test("uses the model's plan when it succeeds", async () => {
    const llm = createLlmClient({ env, responses: fakeResponses({ plan_draft: draft({ sources: [draft().sources[1]!] }) }).responses });
    const { ir } = await planForContract(llm, DEMO_CONTRACT, candidates, caps);
    expect(ir.provenance).toMatchObject({ plannedBy: "llm", model: "gpt-6-sol" });
    expect(ir.sources.map((s) => s.ref)).toEqual(["ashby:openai"]);
  });

  test("falls back to the template plan when the model fails", async () => {
    const llm = createLlmClient({ env, responses: fakeResponses({}, { refuse: ["plan_draft"] }).responses });
    const { ir } = await planForContract(llm, DEMO_CONTRACT, candidates, caps);
    expect(ir.provenance.plannedBy).toBe("template");
    expect(ir.provenance.warnings[0]).toContain("Planner unavailable");
    expect(ir.sources).toHaveLength(2);
  });
});

describe("planForContract with workflow memory", () => {
  beforeEach(resetDb);
  const remembered = (d: PlanDraft) => ({ workflowId: crypto.randomUUID(), runId: "run-1", score: 0.93, draft: d });

  test("reuses a remembered plan without calling the planner", async () => {
    const llm = fakeLlm();
    const { ir, reused } = await planForContract(llm, DEMO_CONTRACT, candidates, caps, undefined, remembered(draft()));
    expect(llm.calls).toHaveLength(0);
    expect(reused?.score).toBe(0.93);
    expect(ir.provenance).toMatchObject({ plannedBy: "memory", reusedFrom: "run-1", reuseScore: 0.93 });
    expect(ir.sources).toHaveLength(2);
  });

  test("plans afresh when the remembered plan's sources are mostly gone", async () => {
    const stale = draft({ sources: [{ ...draft().sources[0]!, ref: "lever:gone" }, draft().sources[1]!] });
    const llm = fakeLlm({ plan_draft: draft() });
    const { ir, reused } = await planForContract(llm, DEMO_CONTRACT, candidates, caps, undefined, remembered(stale));
    expect(reused).toBeNull();
    expect(ir.provenance.plannedBy).toBe("llm");
  });
});
