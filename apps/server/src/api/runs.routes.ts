import { CreateRunRequest } from "@repo/contracts";
import { Router } from "express";
import { z } from "zod";
import { createRun, getRunDetail, listEvents, listRuns, requestCancel, startRun } from "../db/repos/runs";
import { notFound } from "../libs/errors";

const RunId = z.string().uuid();
const EventsQuery = z.object({ after: z.coerce.number().int().nonnegative().default(0) });
const ListQuery = z.object({ limit: z.coerce.number().int().positive().max(200).default(50) });

/** Malformed ids can never match a run, so they are reported as 404 rather than 400. */
function runId(raw: string | undefined): string {
  const parsed = RunId.safeParse(raw);
  if (!parsed.success) throw notFound("Run");
  return parsed.data;
}

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
