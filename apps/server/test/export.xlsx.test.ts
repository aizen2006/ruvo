import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Workbook, type CellHyperlinkValue } from "exceljs";
import { db } from "../src/db/client";
import { evidence, records } from "../src/db/schema";
import { attachWorkflow, saveContract, saveWorkflow } from "../src/db/repos/workflows";
import { DEMO_CONTRACT } from "../src/plan/demoContract";
import type { RegistryCompany } from "../src/plan/registry";
import { buildTemplateIr } from "../src/plan/templates";
import { insertRun, resetDb } from "./helpers/db";
import { startTestServer } from "./helpers/http";

const api = startTestServer();
const POSTING = "https://jobs.example.com/acme/42";
let runId: string;

/** One finished run with a planned source, a kept row and a set-aside row carrying a formula. */
beforeAll(async () => {
  await resetDb();
  const run = await insertRun({ status: "completed", modelPlanner: "planner-model", modelWorker: "worker-model" });
  runId = run.id;
  const company = { id: crypto.randomUUID(), name: "Acme", ats: "ashby", slug: "acme", tags: [], boardUrl: null, origin: "curated", jobCount: null, verifiedAt: null } satisfies RegistryCompany;
  const ir = buildTemplateIr(DEMO_CONTRACT, [company], {
    budgets: { maxPages: 10, maxBrowserPages: 0, maxLlmCalls: 0, maxDurationMs: 60_000, maxRecords: 10 },
    maxItemsPerSource: 10,
  });
  const contract = await saveContract({ requestId: run.requestId, contract: DEMO_CONTRACT, editedBy: "template" });
  await attachWorkflow(run.id, (await saveWorkflow({ contractId: contract.id, ir })).id);
  const sourceId = ir.sources[0]!.id;

  const [kept, setAside] = await db
    .insert(records)
    .values([
      { runId, sourceId, itemKey: "a", status: "valid", matchScore: 0.75, confidence: 0.95, data: { company: "Acme", title: "Backend engineer", location: "Remote", url: POSTING } },
      { runId, sourceId, itemKey: "b", status: "invalid", confidence: 0.5, data: { company: "=HYPERLINK(\"http://evil\")", title: "Sales lead", location: "Paris", url: "javascript:alert(1)" } },
    ])
    .returning();
  const receipt = { method: "API" as const, sourceUrl: POSTING, pageId: null, locator: { kind: "jsonPath" as const, value: "$.title" }, verified: true };
  await db.insert(evidence).values([
    { ...receipt, recordId: kept!.id, field: "title", value: "Backend engineer", snippet: "Backend engineer", confidence: 0.95 },
    { ...receipt, recordId: kept!.id, field: "location", value: "Remote", snippet: "Location: Remote", method: "SEARCH", confidence: 0.8 },
    { ...receipt, recordId: setAside!.id, field: "company", value: "=HYPERLINK(\"http://evil\")", snippet: "@SUM(A1)", confidence: 0.5 },
  ]);
});
afterAll(api.close);

async function download(scope: "valid" | "all") {
  const res = await api.raw(`/api/datasets/${runId}/export?format=xlsx&scope=${scope}`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-disposition")).toContain(`-${scope}.xlsx`);
  const workbook = new Workbook();
  await workbook.xlsx.load(await res.arrayBuffer());
  return workbook;
}

const rowValues = (workbook: Workbook, sheet: string, row: number) => (workbook.getWorksheet(sheet)!.getRow(row).values as unknown[]).slice(1);

describe("Excel export", () => {
  test("has Data, Receipts and About sheets", async () => {
    const workbook = await download("valid");
    expect(workbook.worksheets.map((s) => s.name)).toEqual(["Data", "Receipts", "About"]);
  });

  test("Data has the contract's columns under a bold, frozen, filterable header", async () => {
    const workbook = await download("valid");
    const data = workbook.getWorksheet("Data")!;
    expect(rowValues(workbook, "Data", 1)).toEqual([...DEMO_CONTRACT.fields.map((f) => f.name), "Lead", "Lead score", "Certainty", "Source"]);
    expect(data.getRow(1).getCell(1).font?.bold).toBe(true);
    expect(data.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(data.autoFilter).toBeDefined();
    expect(data.rowCount).toBe(2);
    expect(data.getRow(2).getCell("I").value).toBe("Strong");
    expect(data.getRow(2).getCell("J").value).toBe(85);
    expect(data.getRow(2).getCell("K").value).toBe("Sure");
    expect(data.getRow(2).getCell("L").value).toBe("Acme");
  });

  test("web addresses become hyperlinks", async () => {
    const data = (await download("valid")).getWorksheet("Data")!;
    const url = data.getRow(2).getCell(DEMO_CONTRACT.fields.findIndex((f) => f.name === "url") + 1).value as CellHyperlinkValue;
    expect(url).toMatchObject({ text: POSTING, hyperlink: POSTING });
  });

  test("Receipts has one plain-language row per value", async () => {
    const workbook = await download("valid");
    expect(rowValues(workbook, "Receipts", 1)).toEqual(["Data row", "Record", "Column", "Value", "Where it came from", "Source page", "Quote", "Certainty"]);
    // Contract order: title comes before location.
    expect(rowValues(workbook, "Receipts", 2)).toMatchObject([2, "Backend engineer", "title", "Backend engineer", "From the site's data feed", { hyperlink: POSTING }, "Backend engineer", "Sure"]);
    expect(rowValues(workbook, "Receipts", 3)).toMatchObject([2, "Backend engineer", "location", "Remote", "From search results", { hyperlink: POSTING }, "Location: Remote", "Likely"]);
  });

  test("About says what was asked and how it was made", async () => {
    const about = new Map((await download("valid")).getWorksheet("About")!.getSheetValues().slice(1).map((r) => [(r as unknown[])[1], (r as unknown[])[2]]));
    expect(about.get("Your request")).toBe("test prompt");
    expect(about.get("Mode")).toBe("Balanced");
    expect(about.get("Sources")).toBe("Acme (1 row)");
    expect(about.get("Spent on AI")).toBe(0);
    expect(about.get("Model that reads the pages")).toBe("worker-model");
    expect(about.get("Collected")).toBeInstanceOf(Date);
  });

  test("scope=all marks set-aside rows and neutralises formulas", async () => {
    const workbook = await download("all");
    const header = rowValues(workbook, "Data", 1);
    expect(header).toContain("Status");
    const setAside = workbook.getWorksheet("Data")!.getRow(3);
    expect(setAside.getCell(header.indexOf("Status") + 1).value).toBe("Set aside");
    expect(setAside.getCell(1).value).toBe("'=HYPERLINK(\"http://evil\")");
    // Only http(s) addresses are linked.
    expect(setAside.getCell(DEMO_CONTRACT.fields.findIndex((f) => f.name === "url") + 1).value).toBe("javascript:alert(1)");

    const receipt = rowValues(workbook, "Receipts", 4);
    expect(receipt[3]).toBe("'=HYPERLINK(\"http://evil\")");
    expect(receipt[6]).toBe("'@SUM(A1)");
  });
});
