/** USD per million tokens (OpenAI list prices, checked 2026-09-27). */
const PRICES: Record<string, { input: number; output: number }> = {
  "gpt-6-astra": { input: 10, output: 50 },
  "gpt-6-sol": { input: 2, output: 10 },
  "gpt-6-luna": { input: 0.1, output: 0.5 },
  "text-embedding-3-small": { input: 0.02, output: 0 },
};

/** Cost of one call; unknown models are priced at zero rather than guessed. */
export function costUsd(model: string, tokensIn: number, tokensOut: number): number {
  const price = PRICES[model];
  if (!price) return 0;
  return (tokensIn * price.input + tokensOut * price.output) / 1_000_000;
}
