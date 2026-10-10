/**
 * Frees database space now, as the worker does once a day: `bun run prune` (data older than
 * RETENTION_DAYS, 30 by default) or `bun run prune --days 7`. Deletes stored pages no record cites,
 * duplicate LLM outputs, finished runs' activity and AI and search call logs (see src/db/prune.ts).
 */
import { parseArgs } from "node:util";
import { env } from "../src/config/env";
import { sql as pg } from "../src/db/client";
import { pruneStorage } from "../src/db/prune";

const { values } = parseArgs({ options: { days: { type: "string", default: String(env.RETENTION_DAYS) } } });
const olderThanDays = Number(values.days);
if (!Number.isInteger(olderThanDays) || olderThanDays < 1) throw new Error("--days must be a whole number, at least 1");

const result = await pruneStorage({ olderThanDays });
if (!result) {
  console.log("Another prune is running right now; nothing was done.");
} else {
  console.log(`Deleted ${result.pages} pages (${(result.pageBytes / 1e6).toFixed(1)} MB) older than ${olderThanDays} days that no record cites.`);
  console.log(`Cleared ${result.llmOutputs} duplicate LLM outputs.`);
  console.log(`Deleted ${result.runEvents} activity events of finished runs, ${result.llmCalls} AI call logs and ${result.searchCalls} search logs older than ${olderThanDays} days.`);
  console.log("Postgres reuses the freed space for new data; VACUUM FULL returns it to the disk.");
}
await pg.end();
