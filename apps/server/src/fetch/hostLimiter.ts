import { ATS_BOARD_URL } from "../adapters/ats";

/**
 * The ATS job-board APIs (Greenhouse's, Lever's, Ashby's, Workable's), as the adapters call them. Every board on
 * one of them is a different company, not more pages of one site, so they take more requests at once.
 */
const ATS_API_HOSTS = new Set(Object.values(ATS_BOARD_URL).map((boardUrl) => new URL(boardUrl("board")).host));
/** In-flight requests per ATS API host; every other host gets the limiter's `maxConcurrent`. */
const ATS_MAX_CONCURRENT = 4;

/**
 * Per-host politeness: at most `maxConcurrent` in-flight requests per host (ATS_MAX_CONCURRENT on an ATS API),
 * and request starts spaced at least `delayMs` apart (the robots.txt crawl-delay, or a small floor).
 */
export function createHostLimiter(opts: { maxConcurrent: number; minDelayMs: number }) {
  type HostState = { active: number; max: number; lastStart: Promise<number>; waiters: Array<() => void> };
  const hosts = new Map<string, HostState>();

  const stateFor = (host: string) => {
    let state = hosts.get(host);
    if (!state) {
      const max = ATS_API_HOSTS.has(host) ? ATS_MAX_CONCURRENT : opts.maxConcurrent;
      hosts.set(host, (state = { active: 0, max, lastStart: Promise.resolve(-Infinity), waiters: [] }));
    }
    return state;
  };

  async function acquire(host: string, delayMs: number, signal?: AbortSignal) {
    const state = stateFor(host);
    while (state.active >= state.max) {
      await new Promise<void>((resolve) => state.waiters.push(resolve));
    }
    state.active++;
    // Starts form a chain: each waits for the previous request's actual start plus the delay, so a
    // start that ran late (a busy event loop) still leaves the full gap before the next one.
    const previous = state.lastStart;
    let started!: (at: number) => void;
    state.lastStart = new Promise((resolve) => (started = resolve));
    const previousAt = await previous;
    try {
      const wait = previousAt + Math.max(delayMs, opts.minDelayMs) - Date.now();
      if (wait > 0) await sleep(wait, signal);
      started(Date.now());
    } catch (err) {
      started(previousAt); // the next caller keeps its distance from the last real start
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
