import type { RunEvent, Stage } from "@repo/contracts";
import { desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { runEvents } from "../db/schema";
import { logger } from "../libs/logger";

export type EmitInput = {
  stage: Stage;
  type: string;
  message: string;
  level?: RunEvent["level"];
  sourceId?: string | null;
  data?: unknown;
};

export type EventRow = typeof runEvents.$inferInsert;
export type EventWriter = (rows: EventRow[]) => Promise<void>;

export interface EventBus {
  emit(event: EmitInput): void;
  /** Writes everything buffered so far. */
  flush(): Promise<void>;
  /** Stops the flush timer and writes the remaining buffer. */
  close(): Promise<void>;
}

const writeToDb: EventWriter = async (rows) => {
  await db.insert(runEvents).values(rows);
};

/** Next sequence number for a run, so re-attempted runs append instead of colliding. */
export async function nextEventSeq(runId: string): Promise<number> {
  const [last] = await db
    .select({ seq: runEvents.seq })
    .from(runEvents)
    .where(eq(runEvents.runId, runId))
    .orderBy(desc(runEvents.seq))
    .limit(1);
  return (last?.seq ?? 0) + 1;
}

/**
 * Buffers run events and writes them in batches (every `flushMs`), giving each a
 * monotonically increasing `seq` that the dashboard polls with `?after=seq`.
 */
export function createEventBus(
  runId: string,
  opts: { startSeq: number; flushMs?: number; write?: EventWriter },
): EventBus {
  const write = opts.write ?? writeToDb;
  let seq = opts.startSeq;
  let buffer: EventRow[] = [];
  let pending: Promise<void> = Promise.resolve();

  const flush = () => {
    if (buffer.length === 0) return pending;
    const batch = buffer;
    buffer = [];
    // Chain writes so batches land in sequence order. Events are telemetry: a failed
    // batch is logged and dropped rather than breaking the run or later batches.
    pending = pending
      .then(() => write(batch))
      .catch((err) => {
        logger.warn("Dropped run events", { runId, count: batch.length, error: String(err) });
      });
    return pending;
  };

  const timer = setInterval(() => void flush(), opts.flushMs ?? 250);

  return {
    emit(event) {
      buffer.push({
        runId,
        seq: seq++,
        ts: new Date(),
        stage: event.stage,
        type: event.type,
        level: event.level ?? "info",
        sourceId: event.sourceId ?? null,
        message: event.message,
        data: event.data ?? null,
      });
    },
    flush,
    async close() {
      clearInterval(timer);
      await flush();
    },
  };
}

/** Writes a single event immediately; used for run lifecycle events outside a pipeline's bus. */
export async function appendEvent(runId: string, event: EmitInput) {
  const bus = createEventBus(runId, { startSeq: await nextEventSeq(runId) });
  bus.emit(event);
  await bus.close();
}
