/**
 * Frees database space: `bun run prune` (pages older than 30 days) or `bun run prune --days 7`.
 * Deletes stored pages no record cites and duplicate LLM outputs (see src/db/prune.ts).
 */
import { parseArgs } from "node:util";
import { sql as pg } from "../src/db/client";
import { pruneStorage } from "../src/db/prune";

const { values } = parseArgs({ options: { days: { type: "string", default: "30" } } });
const olderThanDays = Number(values.days);
if (!Number.isInteger(olderThanDays) || olderThanDays < 1) throw new Error("--days must be a whole number, at least 1");

const result = await pruneStorage({ olderThanDays });
console.log(`Deleted ${result.pages} pages (${(result.pageBytes / 1e6).toFixed(1)} MB) older than ${olderThanDays} days that no record cites.`);
console.log(`Cleared ${result.llmOutputs} duplicate LLM outputs.`);
console.log("Postgres reuses the freed space for new data; VACUUM FULL returns it to the disk.");
await pg.end();
