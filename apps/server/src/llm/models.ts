import type { ModelOption } from "@repo/contracts";

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

/** Chat models a user can pick for a run, cheapest first. */
const CHAT_MODELS: Array<Pick<ModelOption, "id" | "label" | "blurb">> = [
  { id: "gpt-6-luna", label: "Luna", blurb: "Fast and cheapest; good at reading pages" },
  { id: "gpt-6-sol", label: "Sol", blurb: "Careful; good at understanding requests" },
  { id: "gpt-6-astra", label: "Astra", blurb: "Most capable and most expensive" },
];

export const modelCatalog = (): ModelOption[] =>
  CHAT_MODELS.map((m) => ({ ...m, inputPerMillion: PRICES[m.id]!.input, outputPerMillion: PRICES[m.id]!.output }));

export const isChatModel = (id: string) => CHAT_MODELS.some((m) => m.id === id);
