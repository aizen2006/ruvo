import { logger } from "./logger";

/** Below the 30s stop_grace_period in docker-compose.prod.yml, so we exit before being killed. */
const SHUTDOWN_TIMEOUT_MS = 25_000;

/**
 * Runs `cleanup` once on the first SIGINT/SIGTERM, then exits. Repeated signals are ignored,
 * and a hard timeout forces exit if cleanup hangs.
 */
export function onShutdown(cleanup: () => Promise<void>) {
  let shuttingDown = false;

  const handle = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("Shutting down", { signal });
    setTimeout(() => {
      logger.error("Shutdown timed out; forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();

    try {
      await cleanup();
      process.exit(0);
    } catch (err) {
      logger.error("Shutdown failed", { error: String(err) });
      process.exit(1);
    }
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, handle);
}
