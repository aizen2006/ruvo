/**
 * Calibrates the decision model's thresholds for semantic criteria: `bun run calibrate`.
 * Samples records from the latest completed run, asks the decision model, labels the same
 * records with the planner LLM, and picks the widest yes/no thresholds that keep precision
 * at or above 90%. Writes src/decide/calibration.json.
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { env } from "../src/config/env";
import { db, sql as pg } from "../src/db/client";
import { records, runs } from "../src/db/schema";
import { loadRunWorkflow } from "../src/db/repos/workflows";
import type { TaskCalibration } from "../src/decide/calibration";
import { createSystemOneClient } from "../src/decide/systemOneClient";
import { truncate } from "../src/libs/text";
import { llm } from "../src/runs/services";

const SAMPLES = 60;
const MIN_PRECISION = 0.9;
const MIN_COVERAGE = 0.25;

const [run] = await db.select({ id: runs.id }).from(runs).where(eq(runs.status, "completed")).orderBy(desc(runs.finishedAt)).limit(1);
if (!run) throw new Error("No completed run to calibrate on; run the demo request first.");
const planned = (await loadRunWorkflow(run.id))!;
const question =
  planned.contract.criteria.find((c) => c.kind === "semantic")?.values[0] ?? "Is this a hands-on backend or AI engineering role?";

const sample = await db
  .select({ data: records.data })
  .from(records)
  .where(and(eq(records.runId, run.id), isNull(records.duplicateOf)))
  .orderBy(sql`random()`)
  .limit(SAMPLES);
const states = sample.map(({ data }) => ({
  title: String(data.title ?? ""),
  team: String(data.department ?? ""),
  location: String(data.location ?? ""),
  company: String(data.company ?? ""),
  description: truncate(String(data.description ?? ""), 800),
}));
console.log(`Calibrating on ${states.length} records from run ${run.id}\nQuestion: ${question}\n`);

const client = createSystemOneClient({ baseUrl: env.DECIDER_BASE_URL, model: env.DECIDER_MODEL, apiKey: env.TYPESAFE_API_KEY, timeoutMs: 10_000 });
let model = env.DECIDER_MODEL;
const probabilities = await Promise.all(
  states.map(async (state) => {
    const res = await client.ask(state, { q: { type: "noul", instructions: question } });
    model = res.model;
    return res.answers.q?.noul ?? 0.5;
  }),
);

const { data: labels } = await llm.parse({
  stage: "calibrate",
  role: "planner",
  schema: z.object({ labels: z.array(z.object({ id: z.string(), answer: z.boolean() })) }),
  name: "calibration_labels",
  system: `Answer the question for each item with true or false, judging carefully from the data. Question: ${question}`,
  user: JSON.stringify(states.map((state, i) => ({ id: String(i), ...state }))),
});
const truth = new Map(labels.labels.map((l) => [Number(l.id), l.answer]));

/**
 * Precision of each side and overall coverage for a pair of thresholds. Both sides are
 * judged separately: a combined figure can hide a weak "no" side when positives dominate.
 */
function evaluate(yes: number, no: number) {
  const side = { yes: { decided: 0, correct: 0 }, no: { decided: 0, correct: 0 } };
  probabilities.forEach((p, i) => {
    const expected = truth.get(i);
    if (expected === undefined) return;
    if (p >= yes) {
      side.yes.decided++;
      if (expected) side.yes.correct++;
    } else if (p <= no) {
      side.no.decided++;
      if (!expected) side.no.correct++;
    }
  });
  const precisionOf = (s: { decided: number; correct: number }) => (s.decided ? s.correct / s.decided : 1);
  const decided = side.yes.decided + side.no.decided;
  return {
    precision: Math.min(precisionOf(side.yes), precisionOf(side.no)),
    coverage: decided / probabilities.length,
    decided,
  };
}

// "no" must stay below 0.5: rejecting when the model leans towards "yes" contradicts it.
let best = { yes: 0.95, no: 0.05, ...evaluate(0.95, 0.05) };
for (let yes = 0.6; yes <= 0.951; yes += 0.05) {
  for (let no = 0.05; no <= 0.451; no += 0.05) {
    const result = evaluate(yes, no);
    if (result.precision >= MIN_PRECISION && result.decided >= 5 && result.coverage > best.coverage) best = { yes, no, ...result };
  }
}

const agreement = probabilities.filter((p, i) => truth.has(i) && (p >= 0.5) === truth.get(i)).length / truth.size;
const mode = best.precision >= MIN_PRECISION && best.coverage >= MIN_COVERAGE ? "active" : "shadow";
const calibration: Record<string, TaskCalibration> = {
  CRITERION: {
    yes: round(best.yes),
    no: round(best.no),
    mode,
    model,
    precision: round(best.precision),
    coverage: round(best.coverage),
    samples: probabilities.length,
    calibratedAt: new Date().toISOString(),
  },
};
await writeFile(new URL("../src/decide/calibration.json", import.meta.url), `${JSON.stringify(calibration, null, 2)}\n`);

console.log(`Agreement with the LLM at p=0.5: ${(agreement * 100).toFixed(0)}%`);
console.log(`Chosen thresholds: yes >= ${round(best.yes)}, no <= ${round(best.no)}`);
console.log(`Precision ${(best.precision * 100).toFixed(0)}%, coverage ${(best.coverage * 100).toFixed(0)}% -> mode ${mode}`);
await pg.end();

function round(n: number) {
  return Math.round(n * 100) / 100;
}
