import { createLlmClient, type LlmClient, type ResponsesApi } from "../../src/llm/client";

type FakeReply = unknown | ((request: { input: Array<{ role: string; content: string }> }) => unknown);

/**
 * A stand-in for `openai.responses` that answers by schema name, e.g.
 * fakeResponses({ contract: {...} }). `refuse` makes a schema return a refusal.
 */
export function fakeResponses(replies: Record<string, FakeReply>, opts: { refuse?: string[] } = {}) {
  const calls: Array<{ name: string; model: string; input: Array<{ role: string; content: string }> }> = [];
  const responses = {
    async parse(body: { model: string; text?: { format?: { name?: string } }; input: Array<{ role: string; content: string }> }) {
      const name = body.text?.format?.name ?? "";
      calls.push({ name, model: body.model, input: body.input });
      if (opts.refuse?.includes(name)) {
        return { output_parsed: null, output: [{ content: [{ type: "refusal", refusal: "not allowed" }] }], usage: { input_tokens: 10, output_tokens: 1 } };
      }
      if (!(name in replies)) throw new Error(`fakeResponses: no reply for schema "${name}"`);
      const reply = replies[name];
      const parsed = typeof reply === "function" ? (reply as (r: { input: typeof body.input }) => unknown)({ input: body.input }) : reply;
      return { output_parsed: parsed, output: [], usage: { input_tokens: 1000, output_tokens: 200 } };
    },
  } as unknown as ResponsesApi;
  return { responses, calls };
}

/** An LlmClient backed by fakeResponses (no caching, no network). */
export function fakeLlm(replies: Record<string, FakeReply> = {}, opts: { refuse?: string[] } = {}): LlmClient & { calls: ReturnType<typeof fakeResponses>["calls"] } {
  const fake = fakeResponses(replies, opts);
  const client = createLlmClient({
    env: { MODEL_PLANNER: "gpt-6-sol", MODEL_WORKER: "gpt-6-luna", LLM_CACHE_MODE: "off", OPENAI_API_KEY: "test" },
    responses: fake.responses,
  });
  return Object.assign(client, { calls: fake.calls });
}
