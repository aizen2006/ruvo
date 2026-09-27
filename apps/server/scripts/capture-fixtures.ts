/**
 * Captures small, trimmed samples of real source responses into test/fixtures/
 * so adapter tests run offline against realistic data: `bun scripts/capture-fixtures.ts`.
 */
import { mkdir, writeFile } from "node:fs/promises";

const OUT = new URL("../test/fixtures/", import.meta.url);
const KEEP = 4;
const MAX_TEXT = 1500;

/** Shortens long strings so fixtures stay small but keep their real shape. */
function trim(value: unknown): unknown {
  if (typeof value === "string") return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value;
  if (Array.isArray(value)) return value.map(trim);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, trim(v)]));
  return value;
}

async function capture(name: string, url: string, pick: (data: any) => unknown) {
  const res = await fetch(url, { headers: { "user-agent": "RUVO/0.1 (+https://github.com/aizen2006/ruvo)" } });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const data = trim(pick(await res.json()));
  await writeFile(new URL(`${name}.json`, OUT), `${JSON.stringify({ url, data }, null, 2)}\n`);
  console.log(`saved ${name}.json`);
}

await mkdir(OUT, { recursive: true });
await capture("greenhouse", "https://boards-api.greenhouse.io/v1/boards/anthropic/jobs?content=true", (d) => ({
  ...d,
  jobs: d.jobs.slice(0, KEEP),
}));
await capture("ashby", "https://api.ashbyhq.com/posting-api/job-board/openai?includeCompensation=true", (d) => ({
  ...d,
  jobs: d.jobs.slice(0, KEEP),
}));
await capture("lever", "https://api.lever.co/v0/postings/palantir?mode=json", (d) => d.slice(0, KEEP));
await capture("workable", "https://apply.workable.com/api/v1/widget/accounts/huggingface", (d) => ({
  ...d,
  jobs: d.jobs.slice(0, KEEP),
}));
