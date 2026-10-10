import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Any fixed number: the advisory lock key that lets one process at a time migrate. */
const MIGRATE_LOCK = 7_402_118;

/**
 * Applies pending SQL migrations from ./drizzle. Safe to run repeatedly, and from several processes at
 * once: the API and the worker both migrate as they start, and the lock makes one wait for the other.
 */
export async function migrateDb(url: string) {
  // One connection, so the session's lock covers the migration; ending the connection releases it.
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await client`select pg_advisory_lock(${MIGRATE_LOCK}::bigint)`;
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.end();
  }
}

if (import.meta.main) {
  const { env } = await import("../config/env");
  await migrateDb(env.DATABASE_URL);
  console.log("migrations applied");
}
