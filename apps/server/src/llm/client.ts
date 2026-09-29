import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { z } from "zod";
import type { Env } from "../config/env";
import { db } from "../db/client";
import { llmCalls } from "../db/schema";
import { sha256, stableStringify } from "../libs/hash";
import type { Budget } from "../runs/budget";
import type { Metrics } from "../runs/metrics";
import { costUsd } from "./models";

/**
 * The only way RUVO talks to an LLM: schema-validated structured output, every call
 * logged to `llm_calls` with its cost, and responses cached by input hash so re-runs
 * are reproducible and cheap (LLM_CACHE_MODE).
 */

export type LlmRole = "planner" | "worker";

export interface ParseRequest<T> {
  /** Pipeline stage, for logs and cost breakdowns (e.g. "compile", "plan"). */
  stage: string;
  role: LlmRole;
  schema: z.ZodType<T>;
  /** Schema name sent to the model; also part of the cache key. */
  name: string;
  system: string;
  user: string;
  signal?: AbortSignal;
  /** Overrides the role's configured model. */
  model?: string;
  /** Attributes the call's cost to a run without drawing on its budget (compile, plan). */
  runId?: string;
  /** When called inside a run: counts the call against the run's budget and metrics. */
  run?: { runId: string; budget: Budget; metrics: Metrics };
}

export interface ParseResult<T> {
  data: T;
  cached: boolean;
  model: string;
  usage: { tokensIn: number; tokensOut: number; costUsd: number };
}

export class LlmError extends Error {
  constructor(
    readonly kind: "budget_exhausted" | "cache_miss" | "refusal" | "invalid_output" | "api",
    message: string,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

/** The slice of the OpenAI SDK we use; tests substitute a fake. */
export type ResponsesApi = Pick<OpenAI["responses"], "parse">;

export interface LlmClient {
  parse<T>(req: ParseRequest<T>): Promise<ParseResult<T>>;
}

export function createLlmClient(opts: {
  env: Pick<Env, "MODEL_PLANNER" | "MODEL_WORKER" | "LLM_CACHE_MODE" | "OPENAI_API_KEY">;
  responses?: ResponsesApi;
  timeoutMs?: number;
}): LlmClient {
  const { env } = opts;
  let responses = opts.responses;
  const api = () => {
    if (!responses) {
      if (!env.OPENAI_API_KEY) throw new LlmError("api", "OPENAI_API_KEY is not set");
      responses = new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 2, timeout: opts.timeoutMs ?? 90_000 }).responses;
    }
    return responses;
  };

  return {
    async parse<T>(req: ParseRequest<T>): Promise<ParseResult<T>> {
      const model = req.model ?? (req.role === "planner" ? env.MODEL_PLANNER : env.MODEL_WORKER);
      const inputHash = sha256(stableStringify({ model, name: req.name, system: req.system, user: req.user }));
      const runId = req.run?.runId ?? req.runId ?? null;
      const log = (row: Partial<typeof llmCalls.$inferInsert>) =>
        db.insert(llmCalls).values({ runId, stage: req.stage, model, schemaName: req.name, inputHash, ms: 0, ...row });

      if (env.LLM_CACHE_MODE !== "off") {
        const hit = await findCached(inputHash);
        if (hit) {
          const parsed = req.schema.safeParse(hit.output);
          if (parsed.success) {
            await log({ output: hit.output, cached: true });
            return { data: parsed.data, cached: true, model, usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 } };
          }
        }
        if (env.LLM_CACHE_MODE === "cache_only") {
          throw new LlmError("cache_miss", `No cached ${req.name} response (LLM_CACHE_MODE=cache_only)`);
        }
      }

      if (req.run && !req.run.budget.take("llmCalls")) {
        throw new LlmError("budget_exhausted", "LLM call budget exhausted for this run");
      }

      const started = Date.now();
      try {
        const response = await api().parse(
          {
            model,
            input: [
              { role: "system", content: req.system },
              { role: "user", content: req.user },
            ],
            text: { format: zodTextFormat(req.schema, req.name) },
          },
          { signal: req.signal },
        );
        const tokensIn = response.usage?.input_tokens ?? 0;
        const tokensOut = response.usage?.output_tokens ?? 0;
        const cost = costUsd(model, tokensIn, tokensOut);
        req.run?.metrics.inc("llmCalls");
        req.run?.metrics.addCost(cost);

        if (response.output_parsed === null || response.output_parsed === undefined) {
          const refusal = findRefusal(response.output);
          const error = refusal ? `Model refused: ${refusal}` : "Model returned no parseable output";
          await log({ tokensIn, tokensOut, costUsd: cost, ms: Date.now() - started, error });
          throw new LlmError(refusal ? "refusal" : "invalid_output", error);
        }

        const data = response.output_parsed as T;
        await log({ output: data as object, tokensIn, tokensOut, costUsd: cost, ms: Date.now() - started });
        return { data, cached: false, model, usage: { tokensIn, tokensOut, costUsd: cost } };
      } catch (err) {
        if (err instanceof LlmError || req.signal?.aborted) throw err;
        const message = err instanceof Error ? err.message : String(err);
        await log({ ms: Date.now() - started, error: message }).catch(() => {});
        throw new LlmError("api", `${req.name} call failed: ${message}`);
      }
    },
  };
}

/**
 * A view of `llm` for one run: each role uses the run's chosen model, and every call is
 * attributed to the run for its cost. Shares the underlying client and cache.
 */
export function scopeLlm(llm: LlmClient, scope: { models?: Partial<Record<LlmRole, string | null>>; runId?: string }): LlmClient {
  return {
    parse: (req) =>
      llm.parse({ ...req, model: req.model ?? scope.models?.[req.role] ?? undefined, runId: req.runId ?? scope.runId }),
  };
}

async function findCached(inputHash: string) {
  const [row] = await db
    .select({ output: llmCalls.output })
    .from(llmCalls)
    .where(and(eq(llmCalls.inputHash, inputHash), isNull(llmCalls.error), isNotNull(llmCalls.output)))
    .orderBy(desc(llmCalls.createdAt))
    .limit(1);
  return row ?? null;
}

function findRefusal(output: unknown): string | null {
  if (!Array.isArray(output)) return null;
  for (const item of output as Array<{ content?: Array<{ type: string; refusal?: string }> }>) {
    const refusal = item.content?.find((c) => c.type === "refusal");
    if (refusal) return refusal.refusal ?? "no reason given";
  }
  return null;
}
