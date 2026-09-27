import { createCircuitBreaker } from "../libs/circuitBreaker";
import { createSemaphore } from "../libs/limit";
import { parseRetryAfter, withRetry } from "../libs/retry";

/**
 * Client for the "System One" decision API shared by TypeSafe Jev (hosted) and Laya
 * (self-hosted): POST {baseUrl}/v1/systemone with a state and named typed questions,
 * answered with calibrated probabilities instead of generated text.
 */

export type SystemOneQuestion =
  | { type: "noul"; instructions: string }
  | { type: "choice"; instructions: string; criteria: Record<string, string> };

export interface SystemOneAnswer {
  type: "noul" | "choice" | "score";
  /** noul: probability the statement is true. */
  noul?: number;
  /** choice: the chosen option, its confidence and every option's probability. */
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
}

export interface SystemOneClient {
  /** False while the circuit breaker is open or no endpoint/key is configured. */
  available(): boolean;
  ask(
    state: string | Record<string, unknown>,
    questions: Record<string, SystemOneQuestion>,
    signal?: AbortSignal,
  ): Promise<{ model: string; answers: Record<string, SystemOneAnswer> }>;
}

export class SystemOneError extends Error {
  constructor(message: string, readonly status?: number, readonly retryAfterMs?: number) {
    super(message);
    this.name = "SystemOneError";
  }
}

export function createSystemOneClient(opts: {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
  concurrency?: number;
}): SystemOneClient {
  const limit = createSemaphore(opts.concurrency ?? 4);
  const breaker = createCircuitBreaker({ threshold: 3, cooldownMs: 60_000 });
  const url = `${opts.baseUrl.replace(/\/$/, "")}/v1/systemone`;

  const call = async (body: string, signal?: AbortSignal) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}) },
      body,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(opts.timeoutMs ?? 3000)]) : AbortSignal.timeout(opts.timeoutMs ?? 3000),
    });
    if (!res.ok) {
      throw new SystemOneError(`System One returned ${res.status}`, res.status, parseRetryAfter(res.headers.get("retry-after")));
    }
    return (await res.json()) as { model: string; answers: Record<string, SystemOneAnswer> };
  };

  return {
    available: () => !breaker.isOpen("systemone"),
    async ask(state, questions, signal) {
      if (breaker.isOpen("systemone")) throw new SystemOneError("Decision service temporarily disabled after repeated failures");
      const body = JSON.stringify({ model: opts.model, state, questions });
      try {
        const result = await limit(() =>
          withRetry(() => call(body, signal), {
            retries: 1,
            baseMs: 300,
            maxDelayMs: 3000,
            shouldRetry: (e) => e instanceof SystemOneError && (e.status === 429 || (e.status ?? 0) >= 500),
            retryAfterMs: (e) => (e instanceof SystemOneError ? e.retryAfterMs : undefined),
            signal,
          }),
        );
        breaker.recordSuccess("systemone");
        return result;
      } catch (err) {
        if (!signal?.aborted) breaker.recordFailure("systemone");
        throw err;
      }
    },
  };
}
