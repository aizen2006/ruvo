/**
 * End-to-end check against a running API and worker: `bun run e2e`.
 * Submits the demo request, waits for it to finish, and verifies the dataset, evidence,
 * exports and quality report, then re-runs the workflow. Exits non-zero on any failure.
 */
import type { Evidence, Page, QualityReport, RecordDTO, RunDetail } from "@repo/contracts";
import { DEMO_PROMPT } from "../src/plan/demoContract";

const API = process.env.E2E_API_URL ?? "http://localhost:3000";
const TIMEOUT_MS = 6 * 60_000;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status}: ${await res.text()}`);
  return res.headers.get("content-type")?.includes("json") ? ((await res.json()) as T) : ((await res.text()) as T);
}

async function waitForRun(runId: string): Promise<RunDetail> {
  const deadline = Date.now() + TIMEOUT_MS;
  let last = "";
  for (;;) {
    const run = await call<RunDetail>(`/api/runs/${runId}`);
    if (run.status !== last) console.log(`  ${run.status} (${run.stage})`);
    last = run.status;
    if (["completed", "failed", "cancelled"].includes(run.status)) return run;
    if (Date.now() > deadline) throw new Error(`Run ${runId} did not finish in time (last status ${run.status})`);
    await Bun.sleep(2000);
  }
}

let failures = 0;
function check(description: string, passed: boolean, detail = "") {
  if (!passed) failures++;
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${description}${detail ? ` (${detail})` : ""}`);
}

console.log(`Submitting the demo request to ${API}`);
const { runId } = await call<{ runId: string }>("/api/runs", { method: "POST", body: JSON.stringify({ prompt: DEMO_PROMPT, autoStart: true }) });
const run = await waitForRun(runId);

console.log("Checking the dataset");
check("run completed", run.status === "completed", run.error ?? "");
check("at least 50 valid records", run.metrics.validRecords >= 50, `${run.metrics.validRecords}`);

const records = await call<Page<RecordDTO>>(`/api/runs/${runId}/records?status=valid&pageSize=5`);
const sample = records.items[0];
check("valid records are listed", Boolean(sample));
if (sample) {
  const { evidence } = await call<{ evidence: Evidence[] }>(`/api/runs/${runId}/evidence/${sample.id}`);
  const fields = new Set(evidence.map((e) => e.field));
  // Models name columns differently ("url", "job_url"); the contract maps each to its catalog key.
  const nameOf = (key: string) => run.contract?.fields.find((f) => f.catalogKey === key)?.name ?? key;
  check("sample record has evidence for company, title and url", ["company", "title", "url"].every((k) => fields.has(nameOf(k))));
  check("every evidence row points at a source URL", evidence.every((e) => e.sourceUrl.startsWith("http")));
  check("sample record has a match reason", typeof sample.data.match_reason === "string" && sample.data.match_reason.length > 0);
  check("sample record has a confidence score", sample.confidence > 0, `${sample.confidence}`);
}

const csv = await call<string>(`/api/datasets/${runId}/export?format=csv&scope=valid`);
const csvRows = csv.trim().split("\r\n").length - 1;
check("CSV has one row per valid record", csvRows === run.metrics.validRecords, `${csvRows} rows`);
const json = await call<unknown[]>(`/api/datasets/${runId}/export?format=json&scope=valid`);
check("JSON export matches the CSV", json.length === csvRows);

const quality = await call<QualityReport>(`/api/runs/${runId}/quality`);
check("quality report totals match the metrics", quality.totals.valid === run.metrics.validRecords);
check("quality report has per-source rows", quality.bySource.length > 0);

console.log("Re-running the workflow");
const rerun = await call<{ runId: string }>(`/api/runs/${runId}/rerun`, { method: "POST" });
const second = await waitForRun(rerun.runId);
check("re-run completed", second.status === "completed", second.error ?? "");
check("re-run used the same workflow", second.workflowId === run.workflowId);
check("re-run made no more LLM calls than the first run", second.metrics.llmCalls <= run.metrics.llmCalls);

console.log(failures ? `\n${failures} check(s) failed` : "\nAll end-to-end checks passed");
process.exit(failures ? 1 : 0);
