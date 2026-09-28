/**
 * Prepares a demo against a running API and worker: `bun run seed:demo`.
 *
 * Runs the demo requests once so that pages, LLM answers, decisions and recipes are cached,
 * which makes the live demo fast and repeatable. For a rehearsed demo, start the server with
 * FETCH_CACHE_MODE=prefer_cache so later runs reuse these pages instead of refetching them.
 *
 * It also resets the Northwind demo site to version 1, so the self-repair demo starts from a
 * working recipe. Prints a link to every seeded run; the first one is the "golden run".
 */
import type { RunDetail } from "@repo/contracts";
import { DEMO_PROMPT } from "../src/plan/demoContract";

const API = process.env.DEMO_API_URL ?? "http://localhost:3000";
const WEB = process.env.DEMO_WEB_URL ?? "http://localhost:3001";
const TIMEOUT_MS = 8 * 60_000;

/** The requests the demo script walks through, in order. */
const REQUESTS = [
  { name: "Golden run: the PRD prompt", prompt: DEMO_PROMPT },
  {
    name: "Self-repair: the Northwind demo site",
    prompt: `Backend, AI infrastructure and machine learning engineering jobs listed on ${API}/fixtures/careers, with job title, location and link`,
  },
];

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

async function waitForRun(runId: string): Promise<RunDetail> {
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const run = await call<RunDetail>(`/api/runs/${runId}`);
    if (["completed", "failed", "cancelled"].includes(run.status)) return run;
    if (Date.now() > deadline) throw new Error(`Run ${runId} did not finish in time (status ${run.status})`);
    await Bun.sleep(2000);
  }
}

await call("/health").catch(() => {
  console.error(`The RUVO API is not reachable at ${API}. Start it with \`bun run dev\` first.`);
  process.exit(1);
});
await call("/fixtures/careers/version", { method: "POST", body: JSON.stringify({ version: 1 }) });
console.log("Northwind demo site reset to version 1\n");

let failed = 0;
for (const request of REQUESTS) {
  console.log(`${request.name}\n  ${request.prompt}`);
  const { runId } = await call<{ runId: string }>("/api/runs", { method: "POST", body: JSON.stringify({ prompt: request.prompt, autoStart: true }) });
  const run = await waitForRun(runId);
  const m = run.metrics;
  if (run.status !== "completed") failed++;
  console.log(`  ${run.status}: ${m.validRecords} valid, ${m.incompleteRecords} incomplete, ${m.llmCalls} LLM calls ($${m.llmCostUsd.toFixed(3)})`);
  console.log(`  ${WEB}/runs/${runId}\n`);
}

if (failed) {
  console.error(`${failed} seeded run(s) did not complete; check their Activity tab before the demo.`);
  process.exit(1);
}
console.log("Demo seeded. Follow docs/demo-script.md.");
