import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { RunTopic, type WorkflowIR } from "@repo/contracts";
import { createDecider } from "../src/decide/decider";
import { claimNextRun, finishRun } from "../src/db/queue";
import { setRunStage } from "../src/db/repos/runs";
import { notifyRunChange, onRunChange } from "../src/db/runChanges";
import type { Fetcher } from "../src/fetch/fetcher";
import { DEMO_CONTRACT } from "../src/plan/demoContract";
import { createEventBus } from "../src/runs/eventBus";
import { createRunContext } from "../src/runs/runContext";
import { insertRun, resetDb, waitFor } from "./helpers/db";
import { fakeLlm } from "./helpers/fakeLlm";
import { startTestServer } from "./helpers/http";

beforeEach(resetDb);

/** Every change announced for run `runId` from now on. */
async function watch(runId: string) {
  const seen: RunTopic[][] = [];
  const off = await onRunChange(runId, (topics) => void seen.push([...topics]));
  return { seen, off };
}

/** Resolves once `seen` holds `count` changes, then gives any stray one a moment to arrive. */
async function settled(seen: RunTopic[][], count: number) {
  await waitFor(async () => seen.length, (n) => n >= count);
  await Bun.sleep(50);
  return seen;
}

describe("run changes", () => {
  test("written events are announced, and recipe events as recipe changes too", async () => {
    const run = await insertRun({ status: "running" });
    const { seen } = await watch(run.id);
    const bus = createEventBus(run.id, { startSeq: 1 });
    bus.emit({ stage: "collecting", type: "step.completed", message: "Acme · collect → 3" });
    await bus.flush();
    bus.emit({ stage: "collecting", type: "recipe.repaired", message: "acme.example: recipe v1 → v2" });
    await bus.close();
    expect(await settled(seen, 2)).toEqual([["events"], ["events", "recipes"]]);
  });

  test("a metrics save names the run, and its records or decisions when their counts moved", async () => {
    const run = await insertRun({ status: "running" });
    const budgets = { maxPages: 10, maxBrowserPages: 0, maxLlmCalls: 0, maxDurationMs: 60_000, maxRecords: 50 };
    const ctx = await createRunContext({
      runId: run.id,
      signal: new AbortController().signal,
      contract: DEMO_CONTRACT,
      ir: { budgets } as WorkflowIR,
      budgets,
      fetcher: {} as Fetcher,
      llm: fakeLlm(),
      decider: createDecider({ provider: null, mode: "off" }),
    });
    const { seen } = await watch(run.id);
    // All before the context's own timer first saves.
    await ctx.saveMetrics();
    ctx.metrics.inc("pagesVisited");
    await ctx.saveMetrics();
    ctx.metrics.inc("validRecords");
    await ctx.saveMetrics();
    ctx.metrics.decision("rules");
    await ctx.saveMetrics();
    await ctx.dispose();
    expect(await settled(seen, 4)).toEqual([["run", "records", "decisions"], ["run"], ["run", "records"], ["run", "decisions"]]);
  });

  test("stage and status changes name the run", async () => {
    const run = await insertRun();
    const { seen } = await watch(run.id);
    await claimNextRun("w1");
    await setRunStage(run.id, "collecting");
    await finishRun(run.id, "w1", "completed");
    expect(await settled(seen, 3)).toEqual([["run"], ["run"], ["run"]]);
  });

  test("a listener that stopped hears nothing more", async () => {
    const run = await insertRun();
    const stopped = await watch(run.id);
    const listening = await watch(run.id);
    stopped.off();
    await notifyRunChange(run.id, ["records"]);
    expect(await settled(listening.seen, 1)).toEqual([["records"]]);
    expect(stopped.seen).toEqual([]);
  });
});

describe("GET /api/runs/:id/stream", () => {
  const api = startTestServer();
  afterAll(api.close);

  /** Opens a run's stream; `next` resolves with the topics of its next message, comments skipped. */
  async function open(runId: string) {
    const browser = new AbortController();
    const res = await api.raw(`/api/runs/${runId}/stream`, { signal: browser.signal });
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    const next = async (): Promise<RunTopic[]> => {
      for (;;) {
        const end = buffer.indexOf("\n\n");
        if (end >= 0) {
          const message = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (message.startsWith("data: ")) return JSON.parse(message.slice("data: ".length)).topics;
          continue;
        }
        const { value, done } = await reader.read();
        if (done) throw new Error("The stream ended");
        buffer += value;
      }
    };
    return { res, next, close: () => browser.abort() };
  }

  test("names every topic first, then what changed, a second's changes together", async () => {
    const run = await insertRun({ status: "running" });
    const other = await insertRun({ status: "running" });
    const stream = await open(run.id);
    try {
      expect(stream.res.headers.get("content-type")).toBe("text/event-stream");
      expect(stream.res.headers.get("cache-control")).toBe("no-cache, no-transform");
      expect(await stream.next()).toEqual(RunTopic.options);

      await notifyRunChange(run.id, ["events"]);
      await notifyRunChange(other.id, ["decisions"]);
      await notifyRunChange(run.id, ["run", "events"]);
      expect(await stream.next()).toEqual(["events", "run"]);
    } finally {
      stream.close();
    }
  });

  test("a run that doesn't exist has no stream", async () => {
    const res = await api.raw(`/api/runs/${crypto.randomUUID()}/stream`);
    expect(res.status).toBe(404);
  });
});
