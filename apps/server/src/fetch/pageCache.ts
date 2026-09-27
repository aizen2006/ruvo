import { and, desc, eq, gt } from "drizzle-orm";
import type { Env } from "../config/env";
import { db } from "../db/client";
import { pages } from "../db/schema";
import { sha256 } from "../libs/hash";

export type CacheMode = Env["FETCH_CACHE_MODE"];
export type PageRow = typeof pages.$inferSelect;
export type Via = PageRow["via"];

/**
 * The `pages` table doubles as the fetch cache and the evidence snapshot store.
 * `ttl` reuses fresh pages; `prefer_cache` / `cache_only` reuse any stored copy, which
 * makes re-runs reproducible and enables a fully offline demo.
 */
export async function findCachedPage(url: string, via: Via, mode: CacheMode, ttlMs: number): Promise<PageRow | null> {
  if (mode === "off") return null;
  const fresh = mode === "ttl" ? gt(pages.fetchedAt, new Date(Date.now() - ttlMs)) : undefined;
  const [page] = await db
    .select()
    .from(pages)
    .where(and(eq(pages.url, url), eq(pages.via, via), fresh))
    .orderBy(desc(pages.fetchedAt))
    .limit(1);
  return page ?? null;
}

export async function savePage(input: {
  url: string;
  finalUrl: string;
  via: Via;
  status: number;
  contentType: string | null;
  body: string;
}): Promise<PageRow> {
  const [page] = await db
    .insert(pages)
    .values({
      ...input,
      host: new URL(input.finalUrl).host,
      contentHash: sha256(input.body),
      bytes: Buffer.byteLength(input.body),
    })
    .returning();
  return page!;
}

export async function getPage(id: string): Promise<PageRow | null> {
  const [page] = await db.select().from(pages).where(eq(pages.id, id));
  return page ?? null;
}
