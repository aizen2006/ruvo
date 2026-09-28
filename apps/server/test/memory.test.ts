import { afterAll, describe, expect, test } from "bun:test";
import type { PlanDraft } from "@repo/contracts";
import { logger } from "../src/libs/logger";
import { createQdrant, type ScoredPoint, type VectorPoint, type VectorStore } from "../src/memory/qdrant";
import { contractSummary, createWorkflowMemory } from "../src/memory/workflowMemory";
import { DEMO_CONTRACT } from "../src/plan/demoContract";

const DRAFT: PlanDraft = { sources: [], fieldStrategies: [], llmBudget: 5, rationale: "remembered" };

/** Letter-frequency vectors: identical text → similarity 1, unrelated text → noticeably lower. */
const embed = async (text: string) => {
  const v = new Array(26).fill(0);
  for (const ch of text.toLowerCase()) if (ch >= "a" && ch <= "z") v[ch.charCodeAt(0) - 97]++;
  return v;
};

/** An in-process VectorStore with cosine similarity. */
function memoryStore(): VectorStore & { points: Map<string, VectorPoint<unknown>> } {
  const points = new Map<string, VectorPoint<unknown>>();
  const cosine = (a: number[], b: number[]) => {
    const dot = a.reduce((s, x, i) => s + x * b[i]!, 0);
    const norm = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    return dot / (norm(a) * norm(b));
  };
  return {
    points,
    ensureCollection: async () => {},
    upsert: async (_c, ps) => void ps.forEach((p) => points.set(p.id, p)),
    search: async <P>(_c: string, vector: number[], limit: number) =>
      [...points.values()]
        .map((p) => ({ id: p.id, score: cosine(vector, p.vector), payload: p.payload as P }) satisfies ScoredPoint<P>)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit),
  };
}

describe("contractSummary", () => {
  test("ignores the order of fields and criteria", () => {
    const shuffled = { ...DEMO_CONTRACT, fields: [...DEMO_CONTRACT.fields].reverse(), criteria: [...DEMO_CONTRACT.criteria].reverse() };
    expect(contractSummary(shuffled)).toBe(contractSummary(DEMO_CONTRACT));
  });
});

describe("workflow memory", () => {
  const input = { workflowId: crypto.randomUUID(), runId: "r1", contract: DEMO_CONTRACT, draft: DRAFT };

  test("remembers good plans only, and recalls them for the same request", async () => {
    const store = memoryStore();
    const memory = createWorkflowMemory({ embed, store, log: logger });
    expect(await memory.remember({ ...input, validRecords: 5 })).toBe(false);
    expect(await memory.remember({ ...input, validRecords: 120 })).toBe(true);
    expect(await memory.recall(DEMO_CONTRACT)).toMatchObject({ workflowId: input.workflowId, runId: "r1", draft: DRAFT });
  });

  test("does not reuse a plan below the similarity or record thresholds", async () => {
    const scored = (score: number, validRecords: number): VectorStore => ({
      ensureCollection: async () => {},
      upsert: async () => {},
      search: async <P>() => [{ id: "w", score, payload: { workflowId: "w", runId: "r", validRecords, planDraft: DRAFT } as P }],
    });
    const recall = (score: number, valid: number) => createWorkflowMemory({ embed, store: scored(score, valid), log: logger }).recall(DEMO_CONTRACT);
    expect(await recall(0.85, 100)).toBeNull();
    expect(await recall(0.95, 10)).toBeNull();
    expect(await recall(0.95, 100)).toMatchObject({ workflowId: "w", score: 0.95 });
  });

  test("never throws when the embedder or store fails", async () => {
    const broken = createWorkflowMemory({ embed: () => Promise.reject(new Error("no key")), store: memoryStore(), log: logger });
    expect(await broken.recall(DEMO_CONTRACT)).toBeNull();
    expect(await broken.remember({ ...input, validRecords: 120 })).toBe(false);
  });
});

describe("qdrant REST client", () => {
  const collection = `ruvo_test_${Date.now()}`;
  const url = process.env.QDRANT_URL ?? "http://localhost:6333";
  const qdrant = createQdrant({ url, timeoutMs: 5_000 });
  afterAll(() => fetch(`${url}/collections/${collection}`, { method: "DELETE" }).catch(() => {}));

  test("creates a collection, upserts and searches", async () => {
    await qdrant.ensureCollection(collection, 3);
    await qdrant.ensureCollection(collection, 3); // idempotent
    const id = crypto.randomUUID();
    await qdrant.upsert(collection, [{ id, vector: [1, 0, 0], payload: { name: "a" } }]);
    const [hit] = await qdrant.search<{ name: string }>(collection, [0.9, 0.1, 0], 1);
    expect(hit).toMatchObject({ id, payload: { name: "a" } });
    expect(hit!.score).toBeGreaterThan(0.9);
  });

  test("a missing collection searches as empty", async () => {
    expect(await qdrant.search(`${collection}_missing`, [1, 0, 0], 1)).toEqual([]);
  });
});
