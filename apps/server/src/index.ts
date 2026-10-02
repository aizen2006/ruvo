import { createApp } from "./app";
import { bootstrap } from "./bootstrap";
import { env } from "./config/env";
import { sql } from "./db/client";
import { logger } from "./libs/logger";
import { onShutdown } from "./libs/shutdown";
import { runPipeline } from "./runs/pipeline";
import { prepareRun } from "./runs/prepare";
import { startWorker } from "./runs/worker";

await bootstrap();

// Inside a container (production) the port mapping decides who can reach the API.
const host = env.HOST ?? (env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const server = createApp().listen(env.PORT, host, () => {
  logger.info("API server started", { host, port: env.PORT, environment: env.NODE_ENV });
});

// Single-process mode: run the worker loop alongside the API (see WORKER_INLINE).
const worker = env.WORKER_INLINE ? startWorker({ execute: runPipeline, prepare: prepareRun }) : null;

onShutdown(async () => {
  // Stop accepting connections; in-flight requests finish while the worker winds down.
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  server.closeIdleConnections();
  await worker?.stop();
  await closed;
  await sql.end({ timeout: 5 });
});
