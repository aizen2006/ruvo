import { sql } from "drizzle-orm";
import { db } from "./client";

export interface PruneResult {
  pages: number;
  pageBytes: number;
  llmOutputs: number;
}

/**
 * Frees database space that nothing needs: stored pages older than `olderThanDays` that no record
 * cites as evidence (receipts keep their source text), and LLM outputs copied onto cache-hit rows
 * by earlier versions (the first answer keeps its copy, which is what the cache reads).
 */
export async function pruneStorage({ olderThanDays }: { olderThanDays: number }): Promise<PruneResult> {
  const [pages] = await db.execute<{ count: number; bytes: number }>(sql`
    with gone as (
      delete from pages p
      where p.fetched_at < now() - make_interval(days => ${olderThanDays})
        and not exists (select 1 from evidence e where e.page_id = p.id)
      returning p.bytes
    )
    select count(*)::int as count, coalesce(sum(bytes), 0)::float as bytes from gone`);
  const [outputs] = await db.execute<{ count: number }>(sql`
    with cleared as (update llm_calls set output = null where cached and output is not null returning 1)
    select count(*)::int as count from cleared`);
  return { pages: Number(pages?.count ?? 0), pageBytes: Number(pages?.bytes ?? 0), llmOutputs: Number(outputs?.count ?? 0) };
}
