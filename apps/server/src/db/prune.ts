import { sql } from "drizzle-orm";
import { db } from "./client";

export interface PruneResult {
  pages: number;
  pageBytes: number;
  llmOutputs: number;
  runEvents: number;
  llmCalls: number;
  searchCalls: number;
}

/** Advisory lock key ("RUVO" in ASCII) held while pruning, so only one process prunes at a time. */
export const PRUNE_LOCK = 0x5255564f;

/**
 * Frees database space that nothing needs: stored pages older than `olderThanDays` that no record
 * cites as evidence (receipts keep their source text), LLM outputs copied onto cache-hit rows
 * by earlier versions (the first answer keeps its copy, which is what the cache reads), and past the
 * same age, finished runs' activity and the AI and search call logs (caches too: a deleted row is a
 * cache miss). Unfinished runs keep their activity, which the dashboard polls by sequence number.
 * Returns null, doing nothing, while another process is pruning.
 */
export async function pruneStorage({ olderThanDays }: { olderThanDays: number }): Promise<PruneResult | null> {
  return db.transaction(async (tx) => {
    const [lock] = await tx.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(${PRUNE_LOCK}) as locked`);
    if (!lock?.locked) return null;

    const cutoff = sql`now() - make_interval(days => ${olderThanDays})`;
    const [pages] = await tx.execute<{ count: number; bytes: number }>(sql`
      with gone as (
        delete from pages p
        where p.fetched_at < ${cutoff}
          and not exists (select 1 from evidence e where e.page_id = p.id)
        returning p.bytes
      )
      select count(*)::int as count, coalesce(sum(bytes), 0)::float as bytes from gone`);
    const [outputs] = await tx.execute<{ count: number }>(sql`
      with cleared as (update llm_calls set output = null where cached and output is not null returning 1)
      select count(*)::int as count from cleared`);
    const [logs] = await tx.execute<{ events: number; llm: number; search: number }>(sql`
      with events as (delete from run_events e using runs r where e.run_id = r.id and r.finished_at < ${cutoff} returning 1),
        llm as (delete from llm_calls where created_at < ${cutoff} returning 1),
        search as (delete from search_calls where created_at < ${cutoff} returning 1)
      select (select count(*) from events)::int as events, (select count(*) from llm)::int as llm, (select count(*) from search)::int as search`);
    return {
      pages: Number(pages?.count ?? 0),
      pageBytes: Number(pages?.bytes ?? 0),
      llmOutputs: Number(outputs?.count ?? 0),
      runEvents: Number(logs?.events ?? 0),
      llmCalls: Number(logs?.llm ?? 0),
      searchCalls: Number(logs?.search ?? 0),
    };
  });
}
