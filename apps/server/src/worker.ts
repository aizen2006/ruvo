import { logger } from "./libs/logger";
import { runPipeline } from "./runs/pipeline";
import { startWorker } from "./runs/worker";

/** Standalone worker process: `bun src/worker.ts`. */
const worker = startWorker({ execute: runPipeline });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    logger.info("Shutting down worker", { signal });
    await worker.stop();
    process.exit(0);
  });
}
