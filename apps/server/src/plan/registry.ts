import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { registryCompanies } from "../db/schema";
import curated from "./data/companies.json";

/**
 * The company registry: companies with a verified public ATS board, plus tags that
 * make "good company" an explainable signal (ai_lab, ai_infra, devtools, …) rather
 * than an unexplained judgement.
 */

export const COMPANY_TAGS = ["ai_lab", "ai_infra", "devtools", "data_platform", "open_source", "consumer_tech", "fintech"] as const;

const CuratedCompany = z.object({
  name: z.string(),
  ats: z.enum(["greenhouse", "ashby", "lever", "workable"]),
  slug: z.string(),
  /** Collect from this public board page with the browser/recipe path instead of the API. */
  boardUrl: z.string().url().optional(),
  tags: z.array(z.enum(COMPANY_TAGS)),
  jobCount: z.number().int().nonnegative(),
  verifiedAt: z.string(),
});
export type CuratedCompany = z.infer<typeof CuratedCompany>;

export type RegistryCompany = typeof registryCompanies.$inferSelect;

export const curatedCompanies = (): CuratedCompany[] => z.array(CuratedCompany).parse(curated);

/** Upserts the curated list into the database. Idempotent; run at startup. */
export async function syncCuratedRegistry() {
  const rows = curatedCompanies().map((c) => ({
    name: c.name,
    ats: c.ats,
    slug: c.slug,
    boardUrl: c.boardUrl ?? null,
    tags: c.tags,
    origin: "curated" as const,
    jobCount: c.jobCount,
    verifiedAt: new Date(c.verifiedAt),
  }));
  if (rows.length === 0) return;
  await db
    .insert(registryCompanies)
    .values(rows)
    .onConflictDoUpdate({
      target: [registryCompanies.ats, registryCompanies.slug],
      set: { name: sql`excluded.name`, boardUrl: sql`excluded.board_url`, tags: sql`excluded.tags`, jobCount: sql`excluded.job_count`, verifiedAt: sql`excluded.verified_at` },
    });
}

export async function listRegistry(): Promise<RegistryCompany[]> {
  return db.select().from(registryCompanies).orderBy(registryCompanies.name);
}
