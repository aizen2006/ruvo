import type { ModelOption } from "@repo/contracts";
import { env } from "../config/env";

/** USD per million tokens (OpenAI list prices, checked 2026-09-27). */
const PRICES: Record<string, { input: number; output: number }> = {
  "gpt-6-astra": { input: 10, output: 50 },
  "gpt-6-sol": { input: 2, output: 10 },
  "gpt-6-luna": { input: 0.1, output: 0.5 },
};

/** Cost of one call; unknown models are priced at zero rather than guessed. */
export function costUsd(model: string, tokensIn: number, tokensOut: number): number {
  const price = PRICES[model];
  if (!price) return 0;
  return (tokensIn * price.input + tokensOut * price.output) / 1_000_000;
}

type ChatModel = Pick<ModelOption, "id" | "label" | "blurb">;

/** Chat models an API-key account can pick for a run, cheapest first. */
const CHAT_MODELS: ChatModel[] = [
  { id: "gpt-6-luna", label: "Luna", blurb: "Fast and cheapest; good at reading pages" },
  { id: "gpt-6-sol", label: "Sol", blurb: "Careful; good at understanding requests" },
  { id: "gpt-6-astra", label: "Astra", blurb: "Most capable and most expensive" },
];

/** What a ChatGPT plan offers through the sign-in server (checked 2026-10-02; it lists gpt-5.5 but refuses it). */
const CHATGPT_MODELS: ChatModel[] = [
  { id: "gpt-6-luna", label: "Luna 6", blurb: "Fast; good at reading pages" },
  { id: "gpt-5.6-luna", label: "Luna 5.6", blurb: "The earlier fast model" },
  { id: "gpt-5.6-terra", label: "Terra 5.6", blurb: "Careful; good at understanding requests" },
];

/** The models the configured AI account can use; on a ChatGPT plan calls are included, so they have no price. */
export const modelCatalog = (): ModelOption[] =>
  env.AI_ACCOUNT === "chatgpt"
    ? CHATGPT_MODELS.map((m) => ({ ...m, inputPerMillion: 0, outputPerMillion: 0 }))
    : CHAT_MODELS.map((m) => ({ ...m, inputPerMillion: PRICES[m.id]!.input, outputPerMillion: PRICES[m.id]!.output }));

export const isChatModel = (id: string) => modelCatalog().some((m) => m.id === id);
