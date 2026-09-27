import { describe, expect, test } from "bun:test";
import { summarizeQuality } from "../src/execute/quality";

const record = (id: string, status: "valid" | "incomplete" | "invalid", extra: Record<string, unknown> = {}) => ({
  id,
  sourceId: "src_a",
  status,
  duplicateOf: null as string | null,
  confidence: 0.99,
  rejectReasons: [] as string[],
  data: { title: "Engineer", salary: null as string | null },
  ...extra,
});

describe("summarizeQuality", () => {
  const report = summarizeQuality({
    fields: ["title", "salary"],
    records: [
      record("1", "valid", { data: { title: "A", salary: "USD 1 / year" } }),
      record("2", "valid", { confidence: 0.8 }),
      record("3", "incomplete", { rejectReasons: ["Missing required field: location"], confidence: 0.6 }),
      record("4", "invalid", { rejectReasons: ["Remote: not met"] }),
      record("5", "valid", { duplicateOf: "1", sourceId: "src_b" }),
    ],
    evidence: [
      { recordId: "1", method: "API", verified: true },
      { recordId: "2", method: "REGEX", verified: true },
      { recordId: "3", method: "LLM", verified: false },
      { recordId: "4", method: "API", verified: true },
    ],
    sourceLabels: new Map([["src_a", "Acme"]]),
  });

  test("totals exclude duplicates", () => {
    expect(report.totals).toEqual({ records: 4, valid: 2, incomplete: 1, invalid: 1, duplicates: 1 });
  });

  test("completeness and evidence stats cover kept records only", () => {
    expect(report.completeness).toEqual([
      { field: "title", filled: 3, total: 3, rate: 1 },
      { field: "salary", filled: 1, total: 3, rate: 1 / 3 },
    ]);
    expect(report.methodMix).toMatchObject({ API: 1, REGEX: 1, LLM: 1 });
    expect(report.verificationRate).toBeCloseTo(2 / 3);
  });

  test("confidence histogram and reject reasons", () => {
    expect(report.confidenceHistogram.map((b) => b.count)).toEqual([0, 1, 1, 1]);
    expect(report.rejectReasons).toEqual([
      { reason: "Missing required field: location", count: 1 },
      { reason: "Remote: not met", count: 1 },
    ]);
  });

  test("per-source breakdown", () => {
    expect(report.bySource).toEqual([
      { sourceId: "src_a", label: "Acme", kept: 3, valid: 2, duplicates: 0 },
      { sourceId: "src_b", label: "src_b", kept: 0, valid: 0, duplicates: 1 },
    ]);
  });
});
