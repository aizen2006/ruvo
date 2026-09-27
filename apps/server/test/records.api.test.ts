import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { attachWorkflow, saveContract, saveWorkflow } from "../src/db/repos/workflows";
import { executeWorkflow } from "../src/execute/executor";
import { toCsv } from "../src/libs/csv";
import { DEMO_CONTRACT } from "../src/plan/demoContract";
import type { RegistryCompany } from "../src/plan/registry";
import { buildTemplateIr } from "../src/plan/templates";
import { createRunContext } from "../src/runs/runContext";
import { insertRun, resetDb } from "./helpers/db";
import { createDecider } from "../src/decide/decider";
import { fakeLlm } from "./helpers/fakeLlm";
import { fixtureFetcher } from "./helpers/fixtures";
import { startTestServer } from "./helpers/http";

const api = startTestServer();
const offDecider = createDecider({ provider: null, mode: "off" });
let runId: string;

/** One executed run over the Ashby + Greenhouse fixtures, shared by every test here. */
beforeAll(async () => {
  await resetDb();
  const run = await insertRun({ status: "running" });
  runId = run.id;
  const companies = [
    { id: crypto.randomUUID(), name: "OpenAI", ats: "ashby", slug: "openai", tags: ["ai_lab"], boardUrl: null, origin: "curated", jobCount: null, verifiedAt: null },
    { id: crypto.randomUUID(), name: "Anthropic", ats: "greenhouse", slug: "anthropic", tags: ["ai_lab"], boardUrl: null, origin: "curated", jobCount: null, verifiedAt: null },
  ] satisfies RegistryCompany[];
  const contract = DEMO_CONTRACT;
  const ir = buildTemplateIr(contract, companies, {
    budgets: { maxPages: 10, maxBrowserPages: 0, maxLlmCalls: 0, maxDurationMs: 60_000, maxRecords: 100 },
    maxItemsPerSource: 40,
  });
  // Without the prefilter every posting is stored, rejected ones as invalid, so filters have data.
  for (const branch of ir.sources) branch.steps = branch.steps.filter((s) => s.kind !== "prefilter");
  const contractRow = await saveContract({ requestId: run.requestId, contract, editedBy: "template" });
  await attachWorkflow(run.id, (await saveWorkflow({ contractId: contractRow.id, ir })).id);

  const { fetcher } = fixtureFetcher({ "ashbyhq.com": "ashby", "greenhouse.io": "greenhouse" });
  const ctx = await createRunContext({ runId, signal: new AbortController().signal, contract, ir, fetcher, llm: fakeLlm(), decider: offDecider });
  await executeWorkflow(ctx);
  await ctx.dispose();
});
afterAll(api.close);

describe("records API", () => {
  test("lists records, valid first, with paging", async () => {
    const { body } = await api.get(`/api/runs/${runId}/records?pageSize=3`);
    expect(body.total).toBeGreaterThan(3);
    expect(body.items).toHaveLength(3);
    expect(body.items[0].status).toBe("valid");
  });

  test("filters by status, search text, salary and source", async () => {
    const invalid = await api.get(`/api/runs/${runId}/records?status=invalid`);
    expect(invalid.body.total).toBeGreaterThan(0);
    expect(invalid.body.items.every((r: { status: string }) => r.status === "invalid")).toBe(true);

    const search = await api.get(`/api/runs/${runId}/records?q=retrieval`);
    expect(search.body.items.map((r: { data: { title: string } }) => r.data.title)).toEqual([
      "Research Engineer, Retrieval & Search, Applied Engineering",
    ]);

    const withSalary = await api.get(`/api/runs/${runId}/records?hasSalary=true`);
    expect(withSalary.body.items.every((r: { data: { salary: unknown } }) => r.data.salary !== null)).toBe(true);
    const withoutSalary = await api.get(`/api/runs/${runId}/records?hasSalary=false`);
    expect(withSalary.body.total + withoutSalary.body.total).toBe((await api.get(`/api/runs/${runId}/records`)).body.total);

    const greenhouseOnly = await api.get(`/api/runs/${runId}/records?source=src_greenhouse_anthropic`);
    expect(greenhouseOnly.body.items.every((r: { data: { company: string } }) => r.data.company === "Anthropic")).toBe(true);
  });

  test("search text is matched literally", async () => {
    expect((await api.get(`/api/runs/${runId}/records?q=%25`)).body.total).toBe(0);
  });

  test("returns a record with its evidence", async () => {
    const { body: page } = await api.get(`/api/runs/${runId}/records?q=retrieval`);
    const { body } = await api.get(`/api/runs/${runId}/evidence/${page.items[0].id}`);
    expect(body.record.id).toBe(page.items[0].id);
    const salary = body.evidence.find((e: { field: string }) => e.field === "salary");
    expect(salary).toMatchObject({ method: "API", locator: { kind: "jsonPath" }, verified: true });
  });

  test("unknown record ids return 404", async () => {
    expect((await api.get(`/api/runs/${runId}/evidence/00000000-0000-0000-0000-000000000000`)).status).toBe(404);
  });
});

describe("export", () => {
  test("CSV has a header plus one row per valid record", async () => {
    const res = await api.raw(`/api/datasets/${runId}/export?format=csv`);
    expect(res.headers.get("content-disposition")).toContain(".csv");
    const lines = (await res.text()).trim().split("\r\n");
    const valid = (await api.get(`/api/runs/${runId}/records?status=valid`)).body.total;
    expect(lines[0]).toStartWith("company,title,location,remote,salary,url");
    expect(lines).toHaveLength(valid + 1);
  });

  test("JSON export includes every record when scope=all", async () => {
    const res = await api.raw(`/api/datasets/${runId}/export?format=json&scope=all`);
    const rows = (await res.json()) as Array<{ _status: string; _evidence: string }>;
    expect(rows.length).toBe((await api.get(`/api/runs/${runId}/records`)).body.total);
    expect(rows[0]!._evidence).toContain("title:API");
  });
});

describe("toCsv", () => {
  test("escapes quotes, commas and newlines", () => {
    expect(toCsv(["a", "b"], [{ a: 'say "hi", ok', b: "line1\nline2" }])).toBe('a,b\r\n"say ""hi"", ok","line1\nline2"\r\n');
  });

  test("neutralises spreadsheet formulas", () => {
    expect(toCsv(["a"], [{ a: "=HYPERLINK(1)" }])).toBe("a\r\n'=HYPERLINK(1)\r\n");
  });
});
