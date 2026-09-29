import { bootstrap } from "./bootstrap";
import { sql } from "./db/client";
import { onShutdown } from "./libs/shutdown";
import { runPipeline } from "./runs/pipeline";
import { prepareRun } from "./runs/prepare";
import { browser } from "./runs/services";
import { startWorker } from "./runs/worker";

/** Standalone worker process: `bun src/worker.ts`. */
await bootstrap();
const worker = startWorker({ execute: runPipeline, prepare: prepareRun });

onShutdown(async () => {
  // Aborts the current run, which hands it back to the queue for the next worker.
  await worker.stop();
  await browser.close();
  await sql.end({ timeout: 5 });
});
