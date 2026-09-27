import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "../src/db/client";
import { decisions } from "../src/db/schema";
import { choiceBand, createDecider, noulBand, type DecisionRequest, type DecisionScope } from "../src/decide/decider";
import type { SystemOneAnswer, SystemOneClient } from "../src/decide/systemOneClient";
import { createBudget } from "../src/runs/budget";
import { createMetrics } from "../src/runs/metrics";
import { resetDb } from "./helpers/db";
import { fakeLlm } from "./helpers/fakeLlm";

beforeEach(resetDb);

/** A decision model that answers with the given noul probability per subject. */
function fakeProvider(answers: Record<string, number>, opts: { down?: boolean } = {}) {
  const asked: string[] = [];
  const client: SystemOneClient = {
    available: () => !opts.down,
    async ask(state) {
      const title = (state as { title: string }).title;
      asked.push(title);
      if (opts.down) throw new Error("unreachable");
      return { model: "jev-1.13.0", answers: { q: { type: "noul", noul: answers[title] ?? 0.5 } satisfies SystemOneAnswer } };
    },
  };
  return { client, asked };
}

function scope(llm = fakeLlm(), maxLlmCalls = 5): DecisionScope {
  return {
    runId: crypto.randomUUID(),
    signal: new AbortController().signal,
    budget: createBudget({ maxPages: 1, maxBrowserPages: 0, maxLlmCalls, maxDurationMs: 60_000, maxRecords: 1 }),
    metrics: createMetrics(),
    llm,
  };
}

const request = (title: string, rule?: () => "yes" | "no" | null): DecisionRequest<"yes" | "no"> => ({
  task: "CRITERION",
  subject: title,
  state: { title },
  question: { type: "noul", instructions: "Is this a backend or AI engineering role?" },
  labels: ["yes", "no"],
  rule,
  band: noulBand(0.8, 0.2),
  defaultLabel: "no",
});

/** An LLM judge that answers "yes" for every item it is shown. */
const judgeYes = () =>
  fakeLlm({
    decision_batch: ({ input }: { input: Array<{ content: string }> }) => ({
      answers: (JSON.parse(input.at(-1)!.content) as Array<{ id: string }>).map((item) => ({ id: item.id, label: "yes", confidence: 0.7 })),
    }),
  });

describe("decider tiers", () => {
  test("rules decide first, confident model answers next, the LLM judge takes the rest", async () => {
    const { client, asked } = fakeProvider({ "Inference Engineer": 0.95, "Account Executive": 0.05, "Member of Technical Staff": 0.55 });
    const llm = judgeYes();
    const s = scope(llm);
    const results = await createDecider({ provider: client, mode: "active" }).decideMany(s, [
      request("Senior Backend Engineer", () => "yes"),
      request("Inference Engineer"),
      request("Account Executive"),
      request("Member of Technical Staff"),
    ]);

    expect(results.map((r) => [r.label, r.decidedBy])).toEqual([
      ["yes", "RULES"],
      ["yes", "DECIDER"],
      ["no", "DECIDER"],
      ["yes", "LLM"],
    ]);
    expect(asked).not.toContain("Senior Backend Engineer");
    expect(results[3]!.shadow).toMatchObject({ label: "yes" });
    expect(llm.calls).toHaveLength(1);
    expect(s.metrics.snapshot().decisions).toEqual({ rules: 1, decider: 2, llm: 1 });
  });

  test("shadow mode asks the model but lets the judge decide", async () => {
    const { client } = fakeProvider({ "Inference Engineer": 0.95 });
    const [result] = await createDecider({ provider: client, mode: "shadow" }).decideMany(scope(judgeYes()), [request("Inference Engineer")]);
    expect(result).toMatchObject({ decidedBy: "LLM", shadow: { label: "yes" } });
  });

  test("an unavailable model falls back to the judge", async () => {
    const { client } = fakeProvider({}, { down: true });
    const [result] = await createDecider({ provider: client, mode: "active" }).decideMany(scope(judgeYes()), [request("Platform Engineer")]);
    expect(result!.decidedBy).toBe("LLM");
  });

  test("without any LLM budget, undecided items take the default label", async () => {
    const [result] = await createDecider({ provider: null, mode: "off" }).decideMany(scope(judgeYes(), 0), [request("Platform Engineer")]);
    expect(result).toMatchObject({ label: "no", decidedBy: "DEFAULT" });
  });

  test("identical questions are answered from the decision cache", async () => {
    const { client, asked } = fakeProvider({ "Inference Engineer": 0.95 });
    const decider = createDecider({ provider: client, mode: "active" });
    await decider.decideMany(scope(), [request("Inference Engineer")]);
    const [again] = await decider.decideMany(scope(), [request("Inference Engineer")]);
    expect(again).toMatchObject({ label: "yes", decidedBy: "DECIDER", cached: true });
    expect(asked).toHaveLength(1);
    expect(await db.select().from(decisions)).toHaveLength(2);
  });
});

describe("bands", () => {
  test("noul band", () => {
    const band = noulBand(0.8, 0.2);
    expect(band({ type: "noul", noul: 0.9 })).toEqual({ label: "yes", confidence: 0.9 });
    expect(band({ type: "noul", noul: 0.1 })!.label).toBe("no");
    expect(band({ type: "noul", noul: 0.5 })).toBeNull();
  });

  test("choice band", () => {
    const band = choiceBand(["remote", "hybrid", "onsite"] as const, 0.75);
    expect(band({ type: "choice", choice: "remote", probabilities: { remote: 0.9 } })).toEqual({ label: "remote", confidence: 0.9 });
    expect(band({ type: "choice", choice: "remote", probabilities: { remote: 0.6 } })).toBeNull();
    expect(band({ type: "choice", choice: "moon", probabilities: { moon: 1 } })).toBeNull();
  });
});
