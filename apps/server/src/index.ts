import { createApp } from "./app";
import { bootstrap } from "./bootstrap";
import { env } from "./config/env";
import { logger } from "./libs/logger";
import { runPipeline } from "./runs/pipeline";
import { startWorker } from "./runs/worker";

await bootstrap();

createApp().listen(env.PORT, () => {
  logger.info("API server started", { port: env.PORT, environment: env.NODE_ENV });
});

// Single-process mode: run the worker loop alongside the API (see WORKER_INLINE).
if (env.WORKER_INLINE) startWorker({ execute: runPipeline });
