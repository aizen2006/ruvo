import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AiAccount } from "@repo/contracts";
import OpenAI from "openai";
import { z } from "zod";
import { env } from "../src/config/env";
import { loadEnv } from "../src/config/envSchema";
import { db } from "../src/db/client";
import { llmCalls } from "../src/db/schema";
import { chatgptFailure, createLlmClient, LlmError, openaiFor } from "../src/llm/client";
import { isChatModel, modelCatalog } from "../src/llm/models";
import { createBudget, type BudgetKey } from "../src/runs/budget";
import { createMetrics } from "../src/runs/metrics";
import { resetDb } from "./helpers/db";
import { startTestServer } from "./helpers/http";

const DATABASE_URL = "postgres://u:p@localhost:5432/db";
const REAL_KEY = "sk-real-key-that-must-stay-home";

const Answer = z.object({ city: z.string() });
const request = { stage: "test", role: "worker" as const, schema: Answer, name: "answer", system: "sys", user: "capital of France?" };

/** A stand-in for the openai-oauth sign-in server: records each request and answers with `reply`. */
function fakeSignIn(reply: () => Response) {
  const hits: Array<{ path: string; authorization: string | null; model: string }> = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as { model: string };
      hits.push({ path: new URL(req.url).pathname, authorization: req.headers.get("authorization"), model: body.model });
      return reply();
    },
  });
  return { url: `http://127.0.0.1:${server.port}/v1`, hits, stop: () => server.stop(true) };
}

/** A completed Responses API reply carrying `data` as its structured output. */
const answered = (data: unknown) =>
  Response.json({
    id: "resp_1",
    object: "response",
    status: "completed",
    output: [{ type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(data), annotations: [] }] }],
    usage: { input_tokens: 1000, output_tokens: 200, total_tokens: 1200 },
  });

/** What the sign-in server sends once the plan's usage limit is reached; retry-after-ms keeps the SDK's retries instant. */
const usageLimit = () =>
  Response.json(
    { error: { type: "usage_limit_reached", message: "The usage limit has been reached" } },
    { status: 429, headers: { "retry-after-ms": "0" } },
  );

const chatgptEnv = (url: string) =>
  loadEnv({ DATABASE_URL, AI_ACCOUNT: "chatgpt", OPENAI_OAUTH_URL: url, OPENAI_API_KEY: REAL_KEY, LLM_CACHE_MODE: "off" });

/** The LlmError a call fails with; checked field by field because Bun's toMatchObject rewrites an Error's message. */
async function failure(call: Promise<unknown>): Promise<LlmError> {
  const error = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(LlmError);
  return error as LlmError;
}

const runScope =(onExhausted?: (key: BudgetKey) => void) => ({
  runId: crypto.randomUUID(),
  budget: createBudget({ maxPages: 1, maxBrowserPages: 0, maxLlmCalls: 5, maxDurationMs: 1000, maxRecords: 1 }, onExhausted),
  metrics: createMetrics(),
});

describe("loadEnv per AI account", () => {
  test("an API-key account defaults to gpt-6-sol and gpt-6-luna", () => {
    const e = loadEnv({ DATABASE_URL });
    expect(e.AI_ACCOUNT).toBe("api_key");
    expect([e.MODEL_PLANNER, e.MODEL_WORKER]).toEqual(["gpt-6-sol", "gpt-6-luna"]);
  });

  test("a ChatGPT plan defaults to gpt-5.6-terra and gpt-6-luna and the local sign-in server", () => {
    const e = loadEnv({ DATABASE_URL, AI_ACCOUNT: "chatgpt" });
    expect([e.MODEL_PLANNER, e.MODEL_WORKER]).toEqual(["gpt-5.6-terra", "gpt-6-luna"]);
    expect(e.OPENAI_OAUTH_URL).toBe("http://127.0.0.1:10531/v1");
  });

  test("explicit MODEL_PLANNER and MODEL_WORKER win on either account", () => {
    for (const account of ["api_key", "chatgpt"]) {
      const e = loadEnv({ DATABASE_URL, AI_ACCOUNT: account, MODEL_PLANNER: "gpt-6-astra", MODEL_WORKER: "gpt-5.6-luna" });
      expect([e.MODEL_PLANNER, e.MODEL_WORKER]).toEqual(["gpt-6-astra", "gpt-5.6-luna"]);
    }
  });

  test("DAILY_BUDGET_USD applies on an API-key account and is dropped on a ChatGPT plan", () => {
    expect(loadEnv({ DATABASE_URL, DAILY_BUDGET_USD: "5" }).DAILY_BUDGET_USD).toBe(5);
    expect(loadEnv({ DATABASE_URL, AI_ACCOUNT: "chatgpt", DAILY_BUDGET_USD: "5" }).DAILY_BUDGET_USD).toBeUndefined();
  });

  test("rejects an unknown account", () => {
    expect(() => loadEnv({ DATABASE_URL, AI_ACCOUNT: "claude" })).toThrow(/AI_ACCOUNT/);
  });
});

describe("llm client on a ChatGPT plan", () => {
  beforeEach(resetDb);

  test("calls the sign-in server without OPENAI_API_KEY, at no cost", async () => {
    const signIn = fakeSignIn(() => answered({ city: "Paris" }));
    try {
      const llm = createLlmClient({ env: { ...chatgptEnv(signIn.url), OPENAI_API_KEY: undefined } });
      const run = runScope();
      const result = await llm.parse({ ...request, run });

      expect(result).toMatchObject({ data: { city: "Paris" }, cached: false, model: "gpt-6-luna", usage: { tokensIn: 1000, tokensOut: 200, costUsd: 0 } });
      expect(signIn.hits).toEqual([{ path: "/v1/responses", authorization: "Bearer unused", model: "gpt-6-luna" }]);
      expect(run.metrics.snapshot().llmCostUsd).toBe(0);
      const [row] = await db.select().from(llmCalls);
      expect(row).toMatchObject({ model: "gpt-6-luna", costUsd: 0, error: null });
    } finally {
      signIn.stop();
    }
  });

  test("never sends a real OPENAI_API_KEY that happens to be set", async () => {
    const signIn = fakeSignIn(() => answered({ city: "Paris" }));
    try {
      await createLlmClient({ env: chatgptEnv(signIn.url) }).parse({ ...request, role: "planner" });
      expect(signIn.hits).toHaveLength(1);
      expect(signIn.hits[0]!.authorization).not.toContain(REAL_KEY);
      expect(signIn.hits[0]!.model).toBe("gpt-5.6-terra");
    } finally {
      signIn.stop();
    }
  });

  test("a usage-limit reply spends the run's AI budget", async () => {
    const signIn = fakeSignIn(usageLimit);
    try {
      const exhausted: BudgetKey[] = [];
      const run = runScope((key) => exhausted.push(key));
      const llm = createLlmClient({ env: chatgptEnv(signIn.url) });

      const error = await failure(llm.parse({ ...request, run }));
      expect(error.kind).toBe("budget_exhausted");
      expect(error.message).toContain("ChatGPT usage limit reached");
      expect(run.budget.left("llmCalls")).toBe(0);
      expect(exhausted).toEqual(["llmCalls"]);

      // The run carries on without AI: the next call never reaches the server.
      const hits = signIn.hits.length;
      await expect(llm.parse({ ...request, run, user: "capital of Italy?" })).rejects.toMatchObject({ kind: "budget_exhausted" });
      expect(signIn.hits).toHaveLength(hits);

      const [row] = await db.select().from(llmCalls);
      expect(row!.error).toBeTruthy();
    } finally {
      signIn.stop();
    }
  });

  test("an unreachable sign-in server says how to start it", async () => {
    const closed = fakeSignIn(() => new Response());
    closed.stop();
    const error = await failure(createLlmClient({ env: chatgptEnv(closed.url) }).parse(request));
    expect(error.kind).toBe("api");
    expect(error.message).toContain(`Can't reach the ChatGPT sign-in server at ${closed.url}`);
    expect(error.message).toContain('"bunx openai-oauth --detach"');
  }, 10_000); // the SDK retries a refused connection twice, with backoff
});

describe("llm client on an API-key account", () => {
  beforeEach(resetDb);

  test("a missing key still fails as before", async () => {
    const e = loadEnv({ DATABASE_URL, LLM_CACHE_MODE: "off" });
    expect(openaiFor(e)).toBeNull();
    await expect(createLlmClient({ env: e }).parse(request)).rejects.toMatchObject({ kind: "api", message: "OPENAI_API_KEY is not set" });
  });

  test("a key reaches OpenAI's API", () => {
    const openai = openaiFor(loadEnv({ DATABASE_URL, OPENAI_API_KEY: REAL_KEY }));
    expect(openai?.apiKey).toBe(REAL_KEY);
    expect(openai?.baseURL).toBe("https://api.openai.com/v1");
  });

  test("a 429 is an ordinary API error that leaves the run's budget alone", async () => {
    const api = fakeSignIn(usageLimit);
    try {
      const responses = new OpenAI({ apiKey: REAL_KEY, baseURL: api.url, maxRetries: 0 }).responses;
      const llm = createLlmClient({ env: loadEnv({ DATABASE_URL, OPENAI_API_KEY: REAL_KEY, LLM_CACHE_MODE: "off" }), responses });
      const run = runScope();
      const error = await failure(llm.parse({ ...request, run }));
      expect(error.kind).toBe("api");
      expect(error.message).toContain("answer call failed");
      expect(run.budget.left("llmCalls")).toBe(4);
    } finally {
      api.stop();
    }
  });
});

describe("chatgptFailure", () => {
  const chatgpt = { OPENAI_API_KEY: undefined, AI_ACCOUNT: "chatgpt" as const, OPENAI_OAUTH_URL: "http://127.0.0.1:10531/v1" };
  const rateLimited = new OpenAI.RateLimitError(429, { message: "limit" }, "429 limit", new Headers());

  test("only applies on a ChatGPT plan", () => {
    expect(chatgptFailure(rateLimited, { ...chatgpt, AI_ACCOUNT: "api_key" })).toBeNull();
    expect(chatgptFailure(new OpenAI.APIConnectionError({ message: "refused" }), { OPENAI_API_KEY: "k" })).toBeNull();
  });

  test("a timeout is not an unreachable server, and other errors pass through", () => {
    expect(chatgptFailure(new OpenAI.APIConnectionTimeoutError(), chatgpt)).toBeNull();
    expect(chatgptFailure(new Error("boom"), chatgpt)).toBeNull();
  });
});

describe("model catalog and options per AI account", () => {
  const api = startTestServer();
  const original = { ...env };
  afterAll(api.close);
  afterEach(() => Object.assign(env, original));

  /** Switches the process configuration to `account` with that account's default models. */
  const useAccount = (account: AiAccount) =>
    Object.assign(env, loadEnv({ ...process.env, AI_ACCOUNT: account, MODEL_PLANNER: "", MODEL_WORKER: "" }));

  test("a ChatGPT plan lists only its models, all at $0", async () => {
    useAccount("chatgpt");
    const { status, body } = await api.get("/api/options");
    expect(status).toBe(200);
    expect(body.account).toBe("chatgpt");
    expect(body.models.map((m: { id: string }) => m.id)).toEqual(["gpt-6-luna", "gpt-5.6-luna", "gpt-5.6-terra"]);
    expect(body.models.every((m: { inputPerMillion: number; outputPerMillion: number }) => m.inputPerMillion === 0 && m.outputPerMillion === 0)).toBe(true);
    expect(body.modes.find((m: { id: string }) => m.id === "balanced").models).toEqual({ planner: "gpt-5.6-terra", worker: "gpt-6-luna" });
    expect(isChatModel("gpt-5.6-terra")).toBe(true);
    expect(isChatModel("gpt-6-sol")).toBe(false);
  });

  test("a ChatGPT plan refuses a run on a model it doesn't offer", async () => {
    useAccount("chatgpt");
    const res = await api.post("/api/runs", { prompt: "Find remote backend roles.", models: { planner: "gpt-6-sol" } });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("gpt-6-sol");
  });

  test("an API-key account keeps its priced models", async () => {
    useAccount("api_key");
    const { body } = await api.get("/api/options");
    expect(body.account).toBe("api_key");
    expect(body.models).toEqual(modelCatalog());
    expect(body.models.map((m: { id: string; inputPerMillion: number; outputPerMillion: number }) => [m.id, m.inputPerMillion, m.outputPerMillion])).toEqual([
      ["gpt-6-luna", 0.1, 0.5],
      ["gpt-6-sol", 2, 10],
      ["gpt-6-astra", 10, 50],
    ]);
    expect(body.modes.find((m: { id: string }) => m.id === "balanced").models).toEqual({ planner: "gpt-6-sol", worker: "gpt-6-luna" });
  });
});
