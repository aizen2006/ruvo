import { beforeEach, describe, expect, test } from "bun:test";
import { certaintyOf, type DatasetContract } from "@repo/contracts";
import { hnWhoIsHiring } from "../src/adapters/hn";
import { toCandidate, type Candidate } from "../src/execute/candidate";
import { match } from "../src/execute/steps/match";
import { triage } from "../src/execute/steps/triage";
import { validate } from "../src/execute/steps/validate";
import { createDecider } from "../src/decide/decider";
import type { SystemOneClient } from "../src/decide/systemOneClient";
import { DEMO_CONTRACT } from "../src/plan/demoContract";
import { createBudget } from "../src/runs/budget";
import { createMetrics } from "../src/runs/metrics";
import type { RunContext } from "../src/runs/runContext";
import { resetDb } from "./helpers/db";
import { fakeLlm } from "./helpers/fakeLlm";
import { fixtureFetcher, loadFixture, testScope } from "./helpers/fixtures";

beforeEach(resetDb);

/** Decision model answering by a predicate over the state it is shown. */
function provider(answer: (state: unknown) => number) {
  const seen: unknown[] = [];
  const client: SystemOneClient = {
    available: () => true,
    async ask(state) {
      seen.push(state);
      return { model: "jev-1.13.0", answers: { q: { type: "noul", noul: answer(state) } } };
    },
  };
  return { client, seen };
}

function context(contract: DatasetContract, client: SystemOneClient) {
  const events: Array<{ type: string; message: string }> = [];
  const ctx = {
    runId: crypto.randomUUID(),
    signal: new AbortController().signal,
    contract,
    budget: createBudget({ maxPages: 1, maxBrowserPages: 0, maxLlmCalls: 0, maxDurationMs: 60_000, maxRecords: 1 }),
    metrics: createMetrics(),
    llm: fakeLlm(),
    decider: createDecider({ provider: client, mode: "active" }),
    emit: (e: { type: string; message: string }) => events.push(e),
  } as unknown as RunContext;
  return { ctx, events };
}

const semanticContract: DatasetContract = {
  ...DEMO_CONTRACT,
  criteria: [
    ...DEMO_CONTRACT.criteria,
    {
      id: "meaning",
      label: "Backend or AI engineering work",
      kind: "semantic",
      fields: ["title"],
      values: ["Is this a hands-on backend or AI engineering role?"],
      strength: "hard",
      weight: 1,
    },
  ],
};

const candidate = (title: string): Candidate =>
  toCandidate("src", {
    externalId: title,
    fields: {
      title: { value: title, evidence: { method: "API", sourceUrl: "https://x.test", pageId: null, snippet: title, locator: { kind: "jsonPath", value: "$" }, verified: true } },
    },
    text: null,
    meta: {},
  });

describe("semantic criteria", () => {
  const step = { id: "m", kind: "match" as const, criteria: semanticContract.criteria.map((c) => c.id) };

  test("are decided by the decision layer, only for candidates still in the running", async () => {
    const { client, seen } = provider((s) => ((s as { title: string }).title.includes("Inference") ? 0.95 : (s as { title: string }).title.includes("IT") ? 0.05 : 0.5));
    const { ctx } = context(semanticContract, client);
    const [inference, it, platform, sales] = await match(ctx, {} as never, step, [
      candidate("Software Engineer, Inference"),
      candidate("IT Systems Engineer"),
      candidate("Platform Engineer"),
      candidate("Account Executive"),
    ]);

    const meaning = (c: Candidate) => c.signals.find((s) => s.criterionId === "meaning")!;
    expect(meaning(inference!)).toMatchObject({ passed: true, decidedBy: "DECIDER" });
    expect(meaning(it!)).toMatchObject({ passed: false, decidedBy: "DECIDER" });
    expect(it!.rejectReasons).toContain("Backend or AI engineering work: not met");
    // Uncertain, and no LLM budget left: undecided rather than rejected.
    expect(meaning(platform!)).toMatchObject({ passed: null, decidedBy: "DEFAULT" });
    expect(platform!.rejectReasons).toEqual([]);
    // Already rejected by a keyword rule, so the model is never asked.
    expect(meaning(sales!).passed).toBeNull();
    expect(seen).toHaveLength(3);
  });
});

describe("sensitive attributes", () => {
  const contract: DatasetContract = {
    ...DEMO_CONTRACT,
    entity: "other",
    entityDescription: "A home cooking creator",
    fields: [{ name: "title", catalogKey: "title", type: "string", required: true, description: "Creator name" }],
    criteria: [{ id: "origin", label: "Indian origin", kind: "semantic", fields: ["title"], values: ["Is this creator of Indian origin?"], strength: "soft", weight: 1 }],
    sensitive: ["ethnicity"],
  };
  const creator = (name: string, bio: string): Candidate => ({
    ...candidate(name),
    item: { ...candidate(name).item, text: { plain: bio, sourceUrl: "https://x.test", pageId: null } },
  });

  test("need the person's own quoted words; without them a record is never Sure", async () => {
    // The judge says yes to both, quoting a line only the first creator wrote.
    const judge = fakeLlm({
      decision_batch: ({ input }: { input: Array<{ content: string }> }) => ({
        answers: (JSON.parse(input.at(-1)!.content) as Array<{ id: string }>).map((item) => ({
          id: item.id,
          label: "yes",
          confidence: 0.95,
          quote: "I'm an Indian-American home cook",
        })),
      }),
    });
    const { client, seen } = provider(() => 0.99);
    const { ctx } = context(contract, client);
    Object.assign(ctx, {
      llm: judge,
      budget: createBudget({ maxPages: 1, maxBrowserPages: 0, maxLlmCalls: 5, maxDurationMs: 60_000, maxRecords: 10 }),
    });

    const matched = await match(ctx, {} as never, { id: "m", kind: "match", criteria: ["origin"] }, [
      creator("Asha Rao", "Hi! I'm an Indian-American home cook sharing weeknight dals."),
      creator("Priya Sharma", "Weeknight dinners from my Chicago kitchen."),
    ]);
    const [quoted, unquoted] = await validate(ctx, {} as never, { id: "v", kind: "validate", required: ["title"], requireEvidence: true }, matched);

    expect(seen).toHaveLength(0); // the decision model can't quote, so the judge decides
    expect(judge.calls[0]!.input.at(-1)!.content).toContain("Never infer them from a name");
    expect(certaintyOf(quoted!.confidence)).toBe("sure");
    expect(certaintyOf(unquoted!.confidence)).toBe("check");
  });
});

describe("triage", () => {
  test("rules settle parsed posts, the decision model judges prose posts", async () => {
    const threadId = String(loadFixture<{ id: number }>("hn-thread").data.id);
    const { fetcher } = fixtureFetcher({ "hn.algolia.com": "hn-thread" });
    const items = await hnWhoIsHiring.collect({ fetcher, scope: testScope() }, { thread: threadId });
    const candidates = items.map((i) => toCandidate("src_hn", i));

    const { client, seen } = provider((s) => (String(s).toLowerCase().includes("rust") ? 0.9 : 0.1));
    const { ctx, events } = context(DEMO_CONTRACT, client);
    const kept = await triage(ctx, { id: "src_hn", label: "HN" } as never, { id: "t", kind: "triage", task: "RELEVANCE", criterionId: null, llmBudget: 0 }, candidates);

    const unparsed = candidates.filter((c) => !c.item.fields.title).length;
    expect(seen).toHaveLength(unparsed);
    expect(kept.length).toBeLessThan(candidates.length);
    expect(kept.every((c) => (c.item.meta.triage as { label: string }).label !== "no")).toBe(true);
    expect(events.at(-1)?.message).toMatch(/kept \d+ of 40 posts/);
  });
});
