import { and, desc, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Env } from "../config/env";
import { db } from "../db/client";
import { decisions } from "../db/schema";
import { sha256, stableStringify } from "../libs/hash";
import { LlmError } from "../llm/client";
import type { RunContext } from "../runs/runContext";
import { modeFor } from "./calibration";
import type { SystemOneAnswer, SystemOneClient, SystemOneQuestion } from "./systemOneClient";

/**
 * Tiered decisions: deterministic rules → cached decision → decision model (Jev/Laya,
 * accepted only when confident) → batched LLM judge → default. Every decision is recorded
 * with the tier that made it, which doubles as a cache and as labelled training data.
 */

export type DecisionTask = "RELEVANCE" | "CRITERION" | "ROW_VALIDITY" | "REPAIR_ACTION";
export type DecisionTier = "RULES" | "DECIDER" | "LLM" | "DEFAULT";

export interface DecisionRequest<L extends string> {
  task: DecisionTask;
  /** Human-readable subject for logs, e.g. a job title. */
  subject: string;
  state: string | Record<string, unknown>;
  question: SystemOneQuestion;
  labels: readonly L[];
  /** Deterministic answer when the case is obvious; null to ask a model. */
  rule?: () => L | null;
  /** Turns a decision-model answer into a label, or null when it is not confident enough. */
  band: (answer: SystemOneAnswer) => { label: L; confidence: number } | null;
  defaultLabel: L;
}

type Shadow = { label: string; confidence: number };

export interface Decision<L extends string> {
  label: L;
  confidence: number;
  decidedBy: DecisionTier;
  cached: boolean;
  providerModel: string | null;
  /** What the decision model said when it did not decide (shadow mode or low confidence). */
  shadow: Shadow | null;
}

export type DecisionScope = Pick<RunContext, "runId" | "signal" | "budget" | "metrics" | "llm">;

export interface Decider {
  decideMany<L extends string>(scope: DecisionScope, requests: DecisionRequest<L>[]): Promise<Decision<L>[]>;
}

const JUDGE_BATCH = 20;
const JUDGE_PROMPT = `You classify items. Each item has a question, the allowed labels and the item's data.
For every item return its id, exactly one allowed label, and your confidence from 0 to 1.
Judge only from the data given; if it is insufficient, pick the most likely label with low confidence.`;
const JudgeSchema = z.object({ answers: z.array(z.object({ id: z.string(), label: z.string(), confidence: z.number() })) });

/** Band for yes/no questions: confident above `yes`, below `no`, otherwise undecided. */
export const noulBand =
  (yes = 0.8, no = 0.2) =>
  (a: SystemOneAnswer) => {
    if (a.noul === undefined) return null;
    if (a.noul >= yes) return { label: "yes" as const, confidence: a.noul };
    if (a.noul <= no) return { label: "no" as const, confidence: 1 - a.noul };
    return null;
  };

/** Band for choice questions: the chosen option when its probability reaches `min`. */
export const choiceBand =
  <L extends string>(labels: readonly L[], min = 0.75) =>
  (a: SystemOneAnswer) => {
    const label = a.choice as L | undefined;
    const p = label ? (a.probabilities?.[label] ?? a.confidence ?? 0) : 0;
    return label && labels.includes(label) && p >= min ? { label, confidence: p } : null;
  };

export function createDecider(opts: { provider: SystemOneClient | null; mode: Env["DECIDER_MODE"] }): Decider {
  const { provider, mode } = opts;

  return {
    async decideMany<L extends string>(scope: DecisionScope, requests: DecisionRequest<L>[]) {
      const decided: Array<Decision<L> | null> = requests.map(() => null);
      const shadows: Array<Shadow | null> = requests.map(() => null);
      const models: Array<string | null> = requests.map(() => null);
      const hashes = requests.map((r) => sha256(stableStringify({ task: r.task, state: r.state, question: r.question, labels: r.labels })));
      const pending = () => requests.map((_, i) => i).filter((i) => !decided[i]);
      const settle = (i: number, label: L, confidence: number, decidedBy: DecisionTier, cached = false) => {
        decided[i] = { label, confidence, decidedBy, cached, providerModel: models[i]!, shadow: shadows[i]! };
      };

      // 1. Rules
      requests.forEach((r, i) => {
        const label = r.rule?.();
        if (label) settle(i, label, 1, "RULES");
      });

      // 2. Earlier model decisions on identical input
      const cache = await findCached(pending().map((i) => hashes[i]!));
      for (const i of pending()) {
        const hit = cache.get(hashes[i]!);
        const label = hit && requests[i]!.labels.find((l) => l === hit.label);
        if (hit && label) {
          models[i] = hit.providerModel;
          settle(i, label, hit.confidence, hit.decidedBy, true);
        }
      }

      // 3. Decision model: acted on only in active mode and only when confident
      if (provider && mode !== "off") {
        await Promise.all(
          pending().map(async (i) => {
            const r = requests[i]!;
            const taskMode = modeFor(r.task, mode);
            if (taskMode === "off" || !provider.available()) return;
            try {
              const { model, answers } = await provider.ask(r.state, { q: r.question }, scope.signal);
              models[i] = model;
              const banded = answers.q ? r.band(answers.q) : null;
              if (banded && taskMode === "active") settle(i, banded.label, banded.confidence, "DECIDER");
              else if (answers.q) shadows[i] = banded ?? rawShadow(answers.q);
            } catch {
              // Unavailable or failed: the LLM judge decides instead.
            }
          }),
        );
      }

      // 4. Batched LLM judge for whatever is still undecided
      const undecided = pending();
      for (let start = 0; start < undecided.length; start += JUDGE_BATCH) {
        const batch = undecided.slice(start, start + JUDGE_BATCH);
        try {
          const { data } = await scope.llm.parse({
            stage: "decide",
            role: "worker",
            schema: JudgeSchema,
            name: "decision_batch",
            system: JUDGE_PROMPT,
            user: JSON.stringify(
              batch.map((i) => ({ id: String(i), question: requests[i]!.question.instructions, labels: requests[i]!.labels, data: requests[i]!.state })),
            ),
            signal: scope.signal,
            run: scope,
          });
          for (const answer of data.answers) {
            const i = Number(answer.id);
            const label = batch.includes(i) ? requests[i]!.labels.find((l) => l.toLowerCase() === answer.label.trim().toLowerCase()) : undefined;
            if (label) settle(i, label, clamp01(answer.confidence), "LLM");
          }
        } catch (err) {
          if (!(err instanceof LlmError)) throw err;
          break; // budget spent or model unavailable: the rest take their defaults
        }
      }

      // 5. Defaults
      for (const i of pending()) settle(i, requests[i]!.defaultLabel, 0, "DEFAULT");
      const final = decided as Decision<L>[];

      await record(scope, requests, final, hashes);
      for (const d of final) {
        if (d.decidedBy === "RULES") scope.metrics.decision("rules");
        else if (d.decidedBy === "DECIDER") scope.metrics.decision("decider");
        else if (d.decidedBy === "LLM") scope.metrics.decision("llm");
      }
      return final;
    },
  };
}

/** The model's leaning when it was not confident enough to decide. */
function rawShadow(answer: SystemOneAnswer): Shadow | null {
  if (answer.noul !== undefined) return { label: answer.noul >= 0.5 ? "yes" : "no", confidence: Math.abs(answer.noul - 0.5) * 2 };
  if (answer.choice) return { label: answer.choice, confidence: answer.confidence ?? 0 };
  return null;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

async function findCached(hashes: string[]) {
  const byHash = new Map<string, typeof decisions.$inferSelect>();
  if (hashes.length === 0) return byHash;
  const rows = await db
    .select()
    .from(decisions)
    .where(and(inArray(decisions.inputHash, hashes), inArray(decisions.decidedBy, ["DECIDER", "LLM"])))
    .orderBy(desc(decisions.createdAt));
  for (const row of rows) if (!byHash.has(row.inputHash)) byHash.set(row.inputHash, row);
  return byHash;
}

async function record<L extends string>(scope: DecisionScope, requests: DecisionRequest<L>[], final: Decision<L>[], hashes: string[]) {
  const rows = final
    // Cached answers are recorded too, so every run's decision log is complete.
    .map((d, i) => ({ d, r: requests[i]!, hash: hashes[i]! }))
    .map(({ d, r, hash }) => ({
      runId: scope.runId,
      task: r.task,
      subject: r.subject.slice(0, 300),
      inputHash: hash,
      // The question is stored with the input so the decision can be read on its own later.
      state: { ...(typeof r.state === "string" ? { text: r.state } : r.state), question: r.question.instructions },
      label: d.label,
      confidence: d.confidence,
      decidedBy: d.decidedBy,
      providerModel: d.providerModel,
      shadow: d.shadow,
      ms: 0,
    }));
  if (rows.length) await db.insert(decisions).values(rows);
}
