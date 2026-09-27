/**
 * Test preload: makes sure the ruvo_test database exists and is fully migrated.
 * Requires `docker compose up -d` (Postgres on localhost:5432).
 */
import postgres from "postgres";
import { env } from "../src/config/env";
import { migrateDb } from "../src/db/migrate";

const url = new URL(env.DATABASE_URL);
const dbName = url.pathname.slice(1);
if (!dbName.endsWith("_test")) throw new Error(`Refusing to run tests against non-test database "${dbName}"`);

const admin = postgres({ ...parse(url), database: "postgres", max: 1, onnotice: () => {} });
const [exists] = await admin`select 1 from pg_database where datname = ${dbName}`;
if (!exists) await admin.unsafe(`create database "${dbName}"`);
await admin.end();

await migrateDb(env.DATABASE_URL);

function parse(u: URL) {
  return { host: u.hostname, port: Number(u.port || 5432), username: u.username, password: u.password };
}
