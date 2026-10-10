import { createServices } from "./app/services";
import { bootstrap } from "./bootstrap";
import { env } from "./config/env";
import { sql } from "./db/client";
import { onShutdown } from "./libs/shutdown";
import { createPipeline } from "./runs/pipeline";
import { createPreparer } from "./runs/prepare";
import { startWorker } from "./runs/worker";

/** Standalone worker process: `bun src/worker.ts`. */
await bootstrap();
const services = createServices(env);
const worker = startWorker({ execute: createPipeline(services), prepare: createPreparer(services) });

onShutdown(async () => {
  // Aborts the current run, which hands it back to the queue for the next worker.
  await worker.stop();
  await sql.end({ timeout: 5 });
});
