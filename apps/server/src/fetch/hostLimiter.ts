/**
 * Per-host politeness: at most `maxConcurrent` in-flight requests per host, and request
 * starts spaced at least `delayMs` apart (the robots.txt crawl-delay, or a small floor).
 */
export function createHostLimiter(opts: { maxConcurrent: number; minDelayMs: number }) {
  type HostState = { active: number; nextStartAt: number; waiters: Array<() => void> };
  const hosts = new Map<string, HostState>();

  const stateFor = (host: string) => {
    let state = hosts.get(host);
    if (!state) hosts.set(host, (state = { active: 0, nextStartAt: 0, waiters: [] }));
    return state;
  };

  async function acquire(host: string, delayMs: number, signal?: AbortSignal) {
    const state = stateFor(host);
    while (state.active >= opts.maxConcurrent) {
      await new Promise<void>((resolve) => state.waiters.push(resolve));
    }
    state.active++;
    // Reserve the next start slot before sleeping so concurrent callers queue behind it.
    const startAt = Math.max(Date.now(), state.nextStartAt);
    state.nextStartAt = startAt + Math.max(delayMs, opts.minDelayMs);
    const wait = startAt - Date.now();
    if (wait <= 0) return;
    try {
      await sleep(wait, signal);
    } catch (err) {
      release(host);
      throw err;
    }
  }

  function release(host: string) {
    const state = stateFor(host);
    state.active--;
    state.waiters.shift()?.();
  }

  return {
    /** Runs `task` once a slot for `host` is free and its crawl delay has passed; `signal` cancels the wait. */
    async run<T>(host: string, delayMs: number, task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      await acquire(host, delayMs, signal);
      try {
        return await task();
      } finally {
        release(host);
      }
    },
  };
}

export type HostLimiter = ReturnType<typeof createHostLimiter>;

/** Waits `ms`, or rejects with the signal's reason as soon as it aborts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
