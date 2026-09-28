import OpenAI from "openai";
import type { Env } from "../config/env";

/** Turns text into an embedding vector. */
export type Embed = (text: string, signal?: AbortSignal) => Promise<number[]>;

/** OpenAI embeddings (EMBED_MODEL). The client is created on first use, so a missing key only matters if memory is used. */
export function createEmbedder(env: Pick<Env, "OPENAI_API_KEY" | "EMBED_MODEL">, timeoutMs = 5_000): Embed {
  let client: OpenAI | null = null;
  return async (text, signal) => {
    if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
    client ??= new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 1, timeout: timeoutMs });
    const res = await client.embeddings.create({ model: env.EMBED_MODEL, input: text }, { signal });
    const vector = res.data[0]?.embedding;
    if (!vector) throw new Error("Embedding response had no vector");
    return vector;
  };
}
