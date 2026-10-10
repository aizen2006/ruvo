import { env } from "./config/env";
import { migrateDb } from "./db/migrate";
import { logger } from "./libs/logger";
import { syncCuratedRegistry } from "./domains/jobs/registry";

/**
 * Idempotent startup work shared by the API and worker processes. Pending migrations go first: under
 * `bun --watch` a reload brings in new code, and code a migration hasn't caught up with fails every query
 * that touches the changed tables.
 */
export async function bootstrap() {
  await migrateDb(env.DATABASE_URL);
  await syncCuratedRegistry();
  logger.info("Database migrated and company registry synced");
}
