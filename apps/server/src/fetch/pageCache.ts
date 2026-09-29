import { and, desc, eq, gt } from "drizzle-orm";
import type { Env } from "../config/env";
import { db } from "../db/client";
import { pages } from "../db/schema";
import { sha256 } from "../libs/hash";

export type CacheMode = Env["FETCH_CACHE_MODE"];
export type PageRow = typeof pages.$inferSelect;
/** How a page was fetched. Search-result snippets are stored too (via "search"), but never served as fetches. */
export type Via = Exclude<PageRow["via"], "search">;

/**
 * The `pages` table doubles as the fetch cache and the evidence snapshot store.
 * `ttl` reuses fresh pages; `prefer_cache` / `cache_only` reuse any stored copy, which
 * makes re-runs reproducible and enables a fully offline demo.
 */
export async function findCachedPage<V extends Via>(url: string, via: V, mode: CacheMode, ttlMs: number): Promise<(PageRow & { via: V }) | null> {
  if (mode === "off") return null;
  const fresh = mode === "ttl" ? gt(pages.fetchedAt, new Date(Date.now() - ttlMs)) : undefined;
  const [page] = await db
    .select()
    .from(pages)
    .where(and(eq(pages.url, url), eq(pages.via, via), fresh))
    .orderBy(desc(pages.fetchedAt))
    .limit(1);
  return (page as (PageRow & { via: V }) | undefined) ?? null;
}

export async function savePage<V extends PageRow["via"]>(input: {
  url: string;
  finalUrl: string;
  via: V;
  status: number;
  contentType: string | null;
  body: string;
}): Promise<PageRow & { via: V }> {
  const body = withoutNul(input.body);
  const row = { ...input, body, host: new URL(input.finalUrl).host, contentHash: sha256(body), bytes: Buffer.byteLength(body) };
  // Only the generated columns come back: the body can be megabytes.
  const [saved] = await db.insert(pages).values(row).returning({ id: pages.id, fetchedAt: pages.fetchedAt });
  return { ...row, ...saved! };
}

/**
 * Postgres text and jsonb reject NUL, so bodies drop it: raw, and as a JSON `\u0000` escape
 * (one not itself escaped by a backslash), which parsed API data would carry into records.
 */
const withoutNul = (body: string) => body.replaceAll("\u0000", "").replace(/(?<!\\)((?:\\\\)*)\\u0000/g, "$1");

export async function getPage(id: string): Promise<PageRow | null> {
  const [page] = await db.select().from(pages).where(eq(pages.id, id));
  return page ?? null;
}
