import { ExportQuery, LEAD_TIER_LABEL, leadOf } from "@repo/contracts";
import { Router } from "express";
import { exportRecords } from "../db/repos/records";
import { getRunDetail } from "../db/repos/runs";
import { loadRunWorkflow } from "../db/repos/workflows";
import { buildWorkbook, XLSX_MIME } from "../export/workbook";
import { toCsv } from "../libs/csv";
import { parseId } from "./params";

/** A run's deduplicated records are its dataset, so the dataset id is the run id. */
export const datasetsRouter = Router();

datasetsRouter.get("/:runId/export", async (req, res) => {
  const runId = parseId(req.params.runId, "Dataset");
  const { format, scope } = ExportQuery.parse(req.query);
  const run = await getRunDetail(runId);
  const rows = await exportRecords(runId, scope);
  const filename = `ruvo-${runId.slice(0, 8)}-${scope}.${format}`;
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  if (format === "json") {
    res.json(
      rows.map(({ record, evidenceMethods }) => {
        const lead = leadOf(record);
        return { ...record.data, _status: record.status, _lead_tier: lead && LEAD_TIER_LABEL[lead.tier], _lead_score: lead?.score ?? null, _evidence: evidenceMethods };
      }),
    );
    return;
  }

  const fieldNames = run.contract?.fields.map((f) => f.name) ?? [...new Set(rows.flatMap((r) => Object.keys(r.record.data)))];

  if (format === "xlsx") {
    const workflow = await loadRunWorkflow(runId);
    const sourceLabels = new Map(workflow?.ir.sources.map((s) => [s.id, s.label]));
    res.type(XLSX_MIME);
    await buildWorkbook({ run, fieldNames, rows, sourceLabels, scope }).xlsx.write(res);
    return;
  }

  const headers = [...fieldNames, "lead_tier", "lead_score", "status", "match_score", "confidence", "source", "evidence_methods"];
  const csvRows = rows.map(({ record, evidenceMethods }) => {
    const lead = leadOf(record);
    return {
      ...record.data,
      lead_tier: lead && LEAD_TIER_LABEL[lead.tier],
      lead_score: lead?.score,
      status: record.status,
      match_score: record.matchScore.toFixed(2),
      confidence: record.confidence.toFixed(2),
      source: record.sourceId,
      evidence_methods: evidenceMethods,
    };
  });
  res.type("text/csv").send(toCsv(headers, csvRows));
});
