import { CreateRunRequest, DatasetContract, ListRecordsQuery } from "@repo/contracts";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { getDecisionSummary } from "../db/repos/decisions";
import { badRequest } from "../libs/errors";
import { isChatModel } from "../llm/models";
import { modelsForMode } from "../runs/modes";
import { getRecordWithEvidence, listRecords } from "../db/repos/records";
import { createRun, getQualityReport, getRunDetail, getRunDiff, listEvents, listRuns, requestCancel, rerunRun, startRun } from "../db/repos/runs";
import { getRunWorkflow } from "../db/repos/workflows";
import { editRunContract } from "../runs/editContract";
import { fieldNamesOf, parseId } from "./params";

const EventsQuery = z.object({ after: z.coerce.number().int().nonnegative().default(0) });
const ListQuery = z.object({ limit: z.coerce.number().int().positive().max(200).default(50) });

const runId = (raw: string | undefined) => parseId(raw, "Run");

export const runsRouter = Router();

runsRouter.post("/", async (req, res) => {
  const { prompt, autoStart, mode, models: chosen } = CreateRunRequest.parse(req.body);
  const unknown = Object.values(chosen ?? {}).filter((m) => m && !isChatModel(m));
  if (unknown.length) throw badRequest(`Unknown model: ${unknown.join(", ")}`);

  const models = modelsForMode(mode, chosen, env);
  const run = await createRun({ prompt, autoStart, mode, models, idempotencyKey: req.get("Idempotency-Key") ?? undefined });
  res.status(201).json(run);
});

runsRouter.get("/", async (req, res) => {
  const { limit } = ListQuery.parse(req.query);
  res.json(await listRuns(limit));
});

runsRouter.get("/:id", async (req, res) => {
  res.json(await getRunDetail(runId(req.params.id)));
});

runsRouter.post("/:id/start", async (req, res) => {
  res.json({ status: await startRun(runId(req.params.id)) });
});

runsRouter.post("/:id/cancel", async (req, res) => {
  res.json({ status: await requestCancel(runId(req.params.id)) });
});

runsRouter.get("/:id/events", async (req, res) => {
  const { after } = EventsQuery.parse(req.query);
  res.json(await listEvents(runId(req.params.id), after));
});

runsRouter.get("/:id/records", async (req, res) => {
  const id = runId(req.params.id);
  const query = ListRecordsQuery.parse(req.query);
  const { contract } = await getRunDetail(id);
  res.json(await listRecords(id, query, fieldNamesOf(contract)));
});

runsRouter.get("/:id/evidence/:recordId", async (req, res) => {
  res.json(await getRecordWithEvidence(runId(req.params.id), parseId(req.params.recordId, "Record")));
});

runsRouter.get("/:id/workflow", async (req, res) => {
  res.json(await getRunWorkflow(runId(req.params.id)));
});

runsRouter.patch("/:id/contract", async (req, res) => {
  const contract = DatasetContract.parse(req.body?.contract);
  const removeSources = z.array(z.string()).default([]).parse(req.body?.removeSources);
  res.json(await editRunContract(runId(req.params.id), contract, removeSources));
});

runsRouter.post("/:id/rerun", async (req, res) => {
  res.status(201).json(await rerunRun(runId(req.params.id)));
});

runsRouter.get("/:id/quality", async (req, res) => {
  res.json(await getQualityReport(runId(req.params.id)));
});

runsRouter.get("/:id/diff", async (req, res) => {
  res.json(await getRunDiff(runId(req.params.id)));
});

runsRouter.get("/:id/decisions", async (req, res) => {
  res.json(await getDecisionSummary(runId(req.params.id)));
});
