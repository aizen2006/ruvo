import { createApp } from "./app";
import { createServices } from "./app/services";
import { bootstrap } from "./bootstrap";
import { env } from "./config/env";
import { sql } from "./db/client";
import { logger } from "./libs/logger";
import { onShutdown } from "./libs/shutdown";
import { createPipeline } from "./runs/pipeline";
import { createPreparer } from "./runs/prepare";
import { startWorker } from "./runs/worker";

await bootstrap();

// Inside a container (production) the port mapping decides who can reach the API.
const host = env.HOST ?? (env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const server = createApp().listen(env.PORT, host, () => {
  logger.info("API server started", { host, port: env.PORT, environment: env.NODE_ENV });
});

// Single-process mode: run the worker loop alongside the API (see WORKER_INLINE).
const services = env.WORKER_INLINE ? createServices(env) : null;
const worker = services ? startWorker({ execute: createPipeline(services), prepare: createPreparer(services) }) : null;

onShutdown(async () => {
  // Stop accepting connections; in-flight requests finish while the worker winds down.
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  server.closeIdleConnections();
  await worker?.stop();
  await closed;
  await sql.end({ timeout: 5 });
});
