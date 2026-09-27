/**
 * Per-key circuit breaker: after `threshold` consecutive failures the key is "open"
 * (calls are skipped) for `cooldownMs`, so one dead host can't stall a whole run.
 */
export function createCircuitBreaker(opts: { threshold: number; cooldownMs: number; now?: () => number }) {
  const now = opts.now ?? Date.now;
  const state = new Map<string, { failures: number; openUntil: number }>();

  return {
    isOpen(key: string): boolean {
      const s = state.get(key);
      return !!s && s.openUntil > now();
    },
    recordSuccess(key: string) {
      state.delete(key);
    },
    recordFailure(key: string) {
      const s = state.get(key) ?? { failures: 0, openUntil: 0 };
      s.failures++;
      if (s.failures >= opts.threshold) {
        s.openUntil = now() + opts.cooldownMs;
        s.failures = 0;
      }
      state.set(key, s);
    },
  };
}

export type CircuitBreaker = ReturnType<typeof createCircuitBreaker>;
