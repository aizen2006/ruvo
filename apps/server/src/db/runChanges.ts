import { RunTopic } from "@repo/contracts";
import { logger } from "../libs/logger";
import { sql } from "./client";

/**
 * Run changes over Postgres LISTEN/NOTIFY: the worker says what changed about a run (its row, events, records, …)
 * and each API process listens on one connection for all its open streams (api/stream.routes.ts).
 * A notice is the run's id and then its topics, space-separated.
 */
const CHANNEL = "run_changes";

/** Announces that `topics` of run `runId` changed. Best effort: a lost notice waits for the dashboard's fallback poll. */
export async function notifyRunChange(runId: string, topics: RunTopic[]) {
  await sql.notify(CHANNEL, [runId, ...topics].join(" ")).catch((err) => {
    logger.warn("Could not announce a run change", { runId, topics, error: String(err) });
  });
}

type Listener = (topics: readonly RunTopic[]) => void;
/** This process's listeners, by run. */
const listeners = new Map<string, Set<Listener>>();
let listening: Promise<unknown> | undefined;

/**
 * Calls `listener` with what changed each time run `runId` changes, until the returned function is called.
 * When the connection drops and comes back, it is called with every topic, since changes in between were missed.
 */
export async function onRunChange(runId: string, listener: Listener): Promise<() => void> {
  const forRun = listeners.get(runId) ?? new Set<Listener>();
  listeners.set(runId, forRun.add(listener));
  const off = () => {
    forRun.delete(listener);
    if (forRun.size === 0) listeners.delete(runId);
  };
  try {
    await (listening ??= listen());
  } catch (err) {
    // The next stream tries again.
    listening = undefined;
    off();
    throw err;
  }
  return off;
}

function listen() {
  let reconnected = false;
  return sql.listen(
    CHANNEL,
    (notice) => {
      const [runId, ...topics] = notice.split(" ");
      listeners.get(runId!)?.forEach((listener) => listener(topics as RunTopic[]));
    },
    // Called after every LISTEN: after the first, the connection was lost and restored.
    () => {
      if (reconnected) for (const forRun of listeners.values()) forRun.forEach((listener) => listener(RunTopic.options));
      reconnected = true;
    },
  );
}
