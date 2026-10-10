import { RunTopic } from "@repo/contracts";
import { Router } from "express";
import { getStatus } from "../db/repos/runs";
import { onRunChange } from "../db/runChanges";
import { parseId } from "./params";

/** Changes go out at most this often, each message naming everything that changed since the last. */
const BATCH_MS = 1000;
/** A comment this often keeps an idle stream open through the dashboard's server and any proxy. */
const HEARTBEAT_MS = 15_000;

/** What changed about a run, as it happens, so the dashboard need not poll. */
export const streamRouter = Router();

/**
 * Server-sent events naming what changed about a run, e.g. `data: {"topics":["events","run"]}`, so the dashboard
 * refetches only that. The first message names every topic, which covers changes made before the stream opened.
 */
streamRouter.get("/:id/stream", async (req, res) => {
  const id = parseId(req.params.id, "Run");
  await getStatus(id);

  const send = (topics: readonly RunTopic[]) => res.write(`data: ${JSON.stringify({ topics })}\n\n`);
  const changed = new Set<RunTopic>();
  let batch: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stop = await onRunChange(id, (topics) => {
    for (const topic of topics) changed.add(topic);
    batch ??= setTimeout(() => {
      batch = undefined;
      send([...changed]);
      changed.clear();
    }, BATCH_MS);
  });
  const close = () => {
    stop();
    clearTimeout(batch);
    clearInterval(heartbeat);
  };
  // The browser may have gone while listening started.
  if (res.closed) return close();

  // no-transform keeps compression (the dashboard's server compresses answers) from holding messages back.
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform" });
  send(RunTopic.options);
  heartbeat = setInterval(() => res.write(": still here\n\n"), HEARTBEAT_MS);
  res.on("close", close);
});
