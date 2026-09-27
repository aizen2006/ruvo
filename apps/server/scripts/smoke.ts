/**
 * Verifies every external dependency RUVO needs: `bun run smoke`.
 * Checks that need a missing API key are reported as "skip", not failures.
 */
import { SQL } from "bun";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { chromium } from "playwright";
import { z } from "zod";
import { env } from "../src/config/env";

type Outcome = { status: "pass" | "fail" | "skip"; detail: string };
type Check = { name: string; run: () => Promise<Outcome> };

const pass = (detail: string): Outcome => ({ status: "pass", detail });
const skip = (detail: string): Outcome => ({ status: "skip", detail });

const openai = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;

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
  {
    name: "qdrant",
    run: async () => {
      const res = await fetch(`${env.QDRANT_URL}/healthz`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return pass(await res.text());
    },
  },
  { name: `openai ${env.MODEL_PLANNER}`, run: () => openaiParse(env.MODEL_PLANNER) },
  { name: `openai ${env.MODEL_WORKER}`, run: () => openaiParse(env.MODEL_WORKER) },
  {
    name: `openai ${env.EMBED_MODEL}`,
    run: async () => {
      if (!openai) return skip("OPENAI_API_KEY not set");
      const res = await openai.embeddings.create({ model: env.EMBED_MODEL, input: "backend engineer" });
      return pass(`${res.data[0]?.embedding.length} dims`);
    },
  },
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
    name: `playwright (${env.BROWSER_MODE})`,
    run: async () => {
      const browser = await chromium.launch();
      const page = await browser.newPage();
      await page.setContent("<p>ruvo</p>");
      const text = await page.innerText("p");
      await browser.close();
      return pass(`chromium ${browser.version()} rendered "${text}"`);
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
