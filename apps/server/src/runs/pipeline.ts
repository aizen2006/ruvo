import type { RunExecutor } from "./worker";

/**
 * Entry point the worker calls for each claimed run.
 * The collection pipeline (collect → match → validate → store) is wired in here in Phase 2.
 */
export const runPipeline: RunExecutor = async (_run, signal) => {
  signal.throwIfAborted();
};
