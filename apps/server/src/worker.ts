import { bootstrap } from "./bootstrap";
import { logger } from "./libs/logger";
import { runPipeline } from "./runs/pipeline";
import { prepareRun } from "./runs/prepare";
import { browser } from "./runs/services";
import { startWorker } from "./runs/worker";

/** Standalone worker process: `bun src/worker.ts`. */
await bootstrap();
const worker = startWorker({ execute: runPipeline, prepare: prepareRun });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    logger.info("Shutting down worker", { signal });
    await worker.stop();
    await browser.close();
    process.exit(0);
  });
}
