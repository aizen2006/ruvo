import { beforeEach, describe, expect, test } from "bun:test";
import { createDecider, type DecisionScope } from "../src/decide/decider";
import type { SystemOneClient } from "../src/decide/systemOneClient";
import { FetchError } from "../src/fetch/errors";
import { classifyError, classifyReplay } from "../src/repair/classify";
import { chooseRepair, type RepairContext } from "../src/repair/policy";
import { createBudget } from "../src/runs/budget";
import { createMetrics } from "../src/runs/metrics";
import { resetDb } from "./helpers/db";
import { fakeLlm } from "./helpers/fakeLlm";

beforeEach(resetDb);

describe("classify", () => {
  test.each([
    [new FetchError("http_status", "HTTP 403", { url: "u", status: 403 }), "BLOCKED"],
    [new FetchError("robots_disallowed", "robots", { url: "u" }), "BLOCKED"],
    [new FetchError("http_status", "HTTP 429", { url: "u", status: 429 }), "RATE_LIMITED"],
    [new FetchError("http_status", "HTTP 503", { url: "u", status: 503 }), "HTTP_ERROR"],
    [new FetchError("network", "timeout", { url: "u" }), "HTTP_ERROR"],
    [new FetchError("budget_exhausted", "budget", { url: "u" }), "BUDGET"],
    [new Error("boom"), "UNKNOWN"],
  ] as const)("%s → %s", (err, kind) => {
    expect(classifyError(err).kind).toBe(kind);
  });

  test("an empty page is a rendering problem, not a selector problem", () => {
    expect(classifyReplay({ rows: [], itemCount: 0, fill: {} }, "SELECTOR_MISS", { textLength: 31 })).toBe("EMPTY_RENDER");
    expect(classifyReplay({ rows: [], itemCount: 0, fill: {} }, "SELECTOR_MISS", { textLength: 5000 })).toBe("SELECTOR_MISS");
  });
});

describe("chooseRepair", () => {
  const scope = (): DecisionScope => ({
    runId: crypto.randomUUID(),
    signal: new AbortController().signal,
    budget: createBudget({ maxPages: 1, maxBrowserPages: 0, maxLlmCalls: 0, maxDurationMs: 60_000, maxRecords: 1 }),
    metrics: createMetrics(),
    llm: fakeLlm(),
  });
  const base: RepairContext = { failure: { kind: "SELECTOR_MISS", detail: "0 items" }, via: "browser", itemsFound: 0, itemsExpected: 8, attempt: 1 };
  const decider = (choice?: string) =>
    createDecider({
      provider: choice
        ? ({ available: () => true, ask: async () => ({ model: "jev-1.13.0", answers: { q: { type: "choice", choice, probabilities: { [choice]: 0.9 } } } }) } satisfies SystemOneClient)
        : null,
      mode: "active",
    });

  test("rules settle the unambiguous cases", async () => {
    expect((await chooseRepair(decider(), scope(), "x", { ...base, failure: { kind: "BLOCKED", detail: "403" } })).action).toBe("STOP");
    expect((await chooseRepair(decider(), scope(), "x", { ...base, failure: { kind: "EMPTY_RENDER", detail: "" }, via: "http" })).action).toBe("SWITCH_TO_BROWSER");
    expect((await chooseRepair(decider(), scope(), "x", { ...base, failure: { kind: "HTTP_ERROR", detail: "" } })).action).toBe("RETRY");
  });

  test("selector problems go to the decision model", async () => {
    expect(await chooseRepair(decider("CHANGE_SELECTOR"), scope(), "x", base)).toEqual({ action: "CHANGE_SELECTOR", decidedBy: "DECIDER" });
  });

  test("without a decision model or LLM budget, the first attempt escalates and later ones stop", async () => {
    expect((await chooseRepair(decider(), scope(), "x", base)).action).toBe("ESCALATE");
    expect((await chooseRepair(decider(), scope(), "x", { ...base, attempt: 2 })).action).toBe("STOP");
  });
});
