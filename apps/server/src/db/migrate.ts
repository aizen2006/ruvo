import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const MIGRATIONS_FOLDER = new URL("../../drizzle", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/** Applies pending SQL migrations from ./drizzle. Safe to run repeatedly. */
export async function migrateDb(url: string) {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
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
