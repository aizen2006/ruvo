import { CreateRunRequest, DatasetContract, ListRecordsQuery } from "@repo/contracts";
import { Router } from "express";
import { z } from "zod";
import { getRecordWithEvidence, listRecords } from "../db/repos/records";
import { createRun, getRunDetail, listEvents, listRuns, requestCancel, rerunRun, startRun } from "../db/repos/runs";
import { getRunWorkflow } from "../db/repos/workflows";
import { editRunContract } from "../runs/editContract";
import { fieldNamesOf, parseId } from "./params";

const EventsQuery = z.object({ after: z.coerce.number().int().nonnegative().default(0) });
const ListQuery = z.object({ limit: z.coerce.number().int().positive().max(200).default(50) });

const runId = (raw: string | undefined) => parseId(raw, "Run");

export const runsRouter = Router();

runsRouter.post("/", async (req, res) => {
  const body = CreateRunRequest.parse(req.body);
  const run = await createRun({ ...body, idempotencyKey: req.get("Idempotency-Key") ?? undefined });
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
  res.json(await editRunContract(runId(req.params.id), contract));
});

runsRouter.post("/:id/rerun", async (req, res) => {
  res.status(201).json(await rerunRun(runId(req.params.id)));
});
