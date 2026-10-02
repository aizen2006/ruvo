/**
 * Verifies every external dependency RUVO needs: `bun run smoke`.
 * Checks that need a missing API key, or the fetch service while it isn't running, are reported as "skip", not failures.
 */
import { $, SQL } from "bun";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { env } from "../src/config/env";

type Outcome = { status: "pass" | "fail" | "skip"; detail: string };
type Check = { name: string; run: () => Promise<Outcome> };

const pass = (detail: string): Outcome => ({ status: "pass", detail });
const skip = (detail: string): Outcome => ({ status: "skip", detail });

const openai = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;
const python = env.SCRAPLING_PYTHON ?? (process.platform === "win32" ? "python" : "python3");

async function openaiParse(model: string): Promise<Outcome> {
  if (!openai) return skip("OPENAI_API_KEY not set");
  const Answer = z.object({ city: z.string() });
  const res = await openai.responses.parse({
    model,
    input: [{ role: "user", content: "Which city is the capital of France? Answer via the schema." }],
    text: { format: zodTextFormat(Answer, "answer") },
  });
  return pass(`parsed ${JSON.stringify(res.output_parsed)}`);
}

const checks: Check[] = [
  {
    name: "postgres",
    run: async () => {
      const sql = new SQL(env.DATABASE_URL);
      const [row] = await sql`select version() as v`;
      await sql.close();
      return pass(String(row.v).split(",")[0] ?? "connected");
    },
  },
  { name: `openai ${env.MODEL_PLANNER}`, run: () => openaiParse(env.MODEL_PLANNER) },
  { name: `openai ${env.MODEL_WORKER}`, run: () => openaiParse(env.MODEL_WORKER) },
  {
    name: `decider ${env.DECIDER_PROVIDER}`,
    run: async () => {
      if (env.DECIDER_PROVIDER === "off") return skip("DECIDER_PROVIDER=off");
      if (env.DECIDER_PROVIDER === "jev" && !env.TYPESAFE_API_KEY) return skip("TYPESAFE_API_KEY not set");
      const res = await fetch(`${env.DECIDER_BASE_URL}/v1/systemone`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(env.TYPESAFE_API_KEY ? { authorization: `Bearer ${env.TYPESAFE_API_KEY}` } : {}),
        },
        body: JSON.stringify({
          model: env.DECIDER_MODEL,
          state: "Senior Backend Engineer, LLM Inference Platform. Remote (US).",
          questions: {
            backend_ai: { type: "noul", instructions: "Is this a backend or AI-infrastructure engineering role?" },
            arrangement: {
              type: "choice",
              instructions: "What is the work arrangement?",
              criteria: { remote: "fully remote", hybrid: "some office days", onsite: "office only" },
            },
          },
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      return pass(JSON.stringify(await res.json()).slice(0, 160));
    },
  },
  {
    name: `scrapling in ${python}`,
    run: async () => {
      const res = await $`${python} -c "import scrapling, starlette, uvicorn; print(scrapling.__version__)"`.quiet().nothrow();
      if (res.exitCode !== 0) {
        const reason = res.stderr.toString().trim().split("\n").at(-1);
        throw new Error(`${reason}; install Scrapling: pip install "scrapling[all]", then scrapling install`);
      }
      return pass(res.text().trim());
    },
  },
  {
    name: `fetch service ${env.SCRAPLING_URL ? new URL(env.SCRAPLING_URL).host : ""}`,
    run: async () => {
      if (!env.SCRAPLING_URL) return skip("off (SCRAPLING_URL is blank): pages are read with plain requests only");
      const health = await fetch(`${env.SCRAPLING_URL}/health`).catch(() => null);
      if (!health) return skip("not running; start it with `bun run dev`");
      if (!health.ok) throw new Error(`/health: HTTP ${health.status}`);
      const { scrapling } = (await health.json()) as { scrapling: string };
      // One real fetch, which goes out through the egress guard.
      const res = await fetch(`${env.SCRAPLING_URL}/fetch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com", engine: "http", timeoutMs: 20_000, maxBytes: 1_000_000 }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const page = (await res.json()) as { status: number };
      return pass(`scrapling ${scrapling} fetched https://example.com: HTTP ${page.status}`);
    },
  },
  {
    name: `searxng ${env.SEARXNG_URL ? new URL(env.SEARXNG_URL).host : ""}`,
    run: async () => {
      if (!env.SEARXNG_URL) return skip("off (SEARXNG_URL is blank): web search needs a Firecrawl key");
      const base = env.SEARXNG_URL.replace(/\/$/, "");
      const health = await fetch(`${base}/healthz`).catch(() => null);
      if (!health) return skip("not running; start it with docker compose up -d");
      if (!health.ok) throw new Error(`/healthz: HTTP ${health.status}`);
      const res = await fetch(`${base}/search?q=SearXNG&format=json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}${res.status === 403 ? ": its settings.yml must allow the json format" : ""}`);
      const { results } = (await res.json()) as { results: unknown[] };
      return pass(`a JSON search found ${results.length} results`);
    },
  },
];

let failed = 0;
for (const check of checks) {
  const outcome = await check.run().catch((e: unknown): Outcome => ({
    status: "fail",
    detail: e instanceof Error ? e.message : String(e),
  }));
  if (outcome.status === "fail") failed++;
  console.log(`${outcome.status.toUpperCase().padEnd(4)}  ${check.name.padEnd(34)} ${outcome.detail}`);
}
process.exit(failed ? 1 : 0);
