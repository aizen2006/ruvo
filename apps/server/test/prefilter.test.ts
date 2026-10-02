import { describe, expect, test } from "bun:test";
import type { SourceBranch, Step } from "@repo/contracts";
import { toCandidate } from "../src/execute/candidate";
import { prefilter } from "../src/execute/steps/prefilter";
import { createMetrics } from "../src/runs/metrics";
import type { RunContext } from "../src/runs/runContext";

const branch = (maxItems: number): SourceBranch => ({
  id: "src_a",
  ref: "a",
  label: "A",
  reason: "test",
  steps: [{ id: "src_a.collect", kind: "collect", adapter: "html_list", params: {}, fetch: "auto", maxItems }],
});

const items = (n: number) =>
  Array.from({ length: n }, (_, i) => toCandidate("src_a", { externalId: String(i), fields: {}, text: null, meta: {} }));

describe("prefilter", () => {
  test("without keywords it keeps everything up to the source's item cap", async () => {
    const metrics = createMetrics();
    const ctx = { metrics, emit: () => {} } as unknown as RunContext;
    const step: Extract<Step, { kind: "prefilter" }> = { id: "src_a.prefilter", kind: "prefilter", keywordsAny: [], keywordsNone: [], fields: ["title"] };

    const kept = await prefilter(ctx, branch(3), step, items(5));

    expect(kept.map((c) => c.item.externalId)).toEqual(["0", "1", "2"]);
    expect(metrics.snapshot().rawRecords).toBe(3);
  });
});
