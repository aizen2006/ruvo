import { CERTAINTY_LABEL, certaintyOf, LEAD_TIER_LABEL, leadOf, SOURCE_PHRASE, type RecordDTO, type RunDetail } from "@repo/contracts";
import { Workbook, type CellHyperlinkValue, type CellValue, type Worksheet } from "exceljs";
import type { ExportRow } from "../db/repos/records";
import { spreadsheetText } from "../libs/spreadsheetText";

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface WorkbookInput {
  run: RunDetail;
  /** The dataset's columns, in contract order. */
  fieldNames: string[];
  rows: ExportRow[];
  /** Source ids to the names the plan gave them; unknown ids are shown as they are. */
  sourceLabels: Map<string, string>;
  scope: "valid" | "all";
}

const STATUS_PHRASE: Record<RecordDTO["status"], string> = { valid: "In your list", incomplete: "Missing a value", invalid: "Set aside" };
const LINK_FONT = { color: { argb: "FF0563C1" }, underline: true } as const;
const MIN_WIDTH = 10;
const MAX_WIDTH = 60;

/**
 * The dataset as an Excel workbook: the rows (Data), one receipt per value (Receipts), and how
 * the list was made (About). Every text cell passes the same formula guard as the CSV export.
 */
export function buildWorkbook({ run, fieldNames, rows, sourceLabels, scope }: WorkbookInput): Workbook {
  const workbook = new Workbook();
  workbook.creator = "RUVO";
  workbook.created = new Date();
  // Rows set aside are only exported with scope "all", which says why each row is there.
  const withStatus = scope === "all";
  addTable(
    workbook.addWorksheet("Data"),
    [...fieldNames, "Lead", "Lead score", "Certainty", ...(withStatus ? ["Status"] : []), "Source"],
    rows.map(({ record }) => {
      const lead = leadOf(record);
      return [
        ...fieldNames.map((name) => cellValue(record.data[name])),
        lead && LEAD_TIER_LABEL[lead.tier],
        lead?.score ?? null,
        CERTAINTY_LABEL[certaintyOf(record.confidence)],
        ...(withStatus ? [STATUS_PHRASE[record.status]] : []),
        spreadsheetText(sourceLabels.get(record.sourceId) ?? record.sourceId),
      ];
    }),
  );

  const primaryField = run.contract?.fields.find((f) => f.catalogKey === "title")?.name ?? fieldNames[0];
  const columnOrder = (field: string) => (fieldNames.includes(field) ? fieldNames.indexOf(field) : fieldNames.length);
  addTable(
    workbook.addWorksheet("Receipts"),
    ["Data row", "Record", "Column", "Value", "Where it came from", "Source page", "Quote", "Certainty"],
    rows.flatMap(({ record, evidence }, index) =>
      evidence
        .toSorted((a, b) => columnOrder(a.field) - columnOrder(b.field))
        .map((e) => [
          index + 2, // the record's row number on the Data sheet, below its header
          spreadsheetText(primaryField ? record.data[primaryField] : record.id),
          spreadsheetText(e.field),
          cellValue(e.value),
          SOURCE_PHRASE[e.method],
          cellValue(e.sourceUrl),
          spreadsheetText(e.snippet),
          CERTAINTY_LABEL[certaintyOf(e.confidence)],
        ]),
    ),
  );

  addAbout(workbook.addWorksheet("About"), run, rows, sourceLabels);
  return workbook;
}

/** A sheet of rows under a bold, frozen, filterable header, with columns sized to their text. */
function addTable(sheet: Worksheet, headers: string[], rows: CellValue[][]) {
  sheet.addRow(headers.map(spreadsheetText)).font = { bold: true };
  sheet.addRows(rows);
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  styleLinks(sheet);
  sizeColumns(sheet, headers.length);
}

function addAbout(sheet: Worksheet, run: RunDetail, rows: ExportRow[], sourceLabels: Map<string, string>) {
  const rowsPerSource = new Map<string, number>([...sourceLabels.keys()].map((id) => [id, 0]));
  for (const { record } of rows) rowsPerSource.set(record.sourceId, (rowsPerSource.get(record.sourceId) ?? 0) + 1);
  const sources = [...rowsPerSource].map(([id, count]) => `${sourceLabels.get(id) ?? id} (${count} ${count === 1 ? "row" : "rows"})`);

  const add = (label: string, value: CellValue, numFmt?: string) => {
    const row = sheet.addRow([label, value]);
    if (numFmt) row.getCell(2).numFmt = numFmt;
  };
  add("List", spreadsheetText(run.contract?.title ?? run.title));
  add("Your request", spreadsheetText(run.prompt));
  add("Mode", run.mode.charAt(0).toUpperCase() + run.mode.slice(1));
  add("Model that understands your request", spreadsheetText(run.models.planner));
  add("Model that reads the pages", spreadsheetText(run.models.worker));
  add("Sources", sources.length ? spreadsheetText(sources.join("\n")) : "None");
  add("Rows", rows.length);
  add("Spent on AI", run.costUsd, "$#,##0.00##");
  add("Collected", new Date(run.finishedAt ?? run.createdAt), "yyyy-mm-dd hh:mm");

  sheet.getColumn(1).font = { bold: true };
  sheet.getColumn(1).width = 36;
  sheet.getColumn(2).width = 80;
  sheet.getColumn(2).alignment = { wrapText: true, vertical: "top", horizontal: "left" };
}

/** A record value as a cell: numbers and booleans stay typed, web addresses become links, the rest guarded text. */
function cellValue(value: unknown): CellValue {
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value) && value.every((v) => typeof v !== "object")) return spreadsheetText(value.join(", "));
  if (typeof value === "string" && isWebAddress(value)) return { text: spreadsheetText(value), hyperlink: value } satisfies CellHyperlinkValue;
  return spreadsheetText(value);
}

/** Only http(s) addresses are linked, so a scraped `javascript:` value stays inert text. */
const isWebAddress = (text: string) => /^https?:\/\//i.test(text) && URL.canParse(text);

function styleLinks(sheet: Worksheet) {
  sheet.eachRow((row) =>
    row.eachCell((cell) => {
      if (cell.hyperlink) cell.font = LINK_FONT;
    }),
  );
}

function sizeColumns(sheet: Worksheet, count: number) {
  for (let i = 1; i <= count; i++) {
    const column = sheet.getColumn(i);
    let longest = 0;
    column.eachCell({ includeEmpty: false }, (cell) => {
      longest = Math.max(longest, cell.text.length);
    });
    column.width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, longest + 2));
  }
}
