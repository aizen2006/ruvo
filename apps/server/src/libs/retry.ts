export interface RetryOptions {
  retries: number;
  baseMs: number;
  maxDelayMs: number;
  /** Decides whether an error is worth another attempt. */
  shouldRetry: (err: unknown) => boolean;
  /** Server-requested wait (e.g. Retry-After), which overrides the computed backoff. */
  retryAfterMs?: (err: unknown) => number | undefined;
  signal?: AbortSignal;
}

/** Runs `fn`, retrying transient failures with exponential backoff plus full jitter. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= opts.retries || !opts.shouldRetry(err) || opts.signal?.aborted) throw err;
      const backoff = Math.random() * opts.baseMs * 2 ** attempt;
      const delay = Math.min(opts.retryAfterMs?.(err) ?? backoff, opts.maxDelayMs);
      await sleepUnlessAborted(delay, opts.signal);
    }
  }
}

function sleepUnlessAborted(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/** Parses an HTTP Retry-After header (seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}
