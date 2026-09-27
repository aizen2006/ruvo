import { logger } from "./libs/logger";
import { syncCuratedRegistry } from "./plan/registry";

/** Idempotent startup work shared by the API and worker processes. */
export async function bootstrap() {
  await syncCuratedRegistry();
  logger.info("Company registry synced");
}
