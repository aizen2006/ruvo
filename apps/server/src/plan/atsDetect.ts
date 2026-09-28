import { sql } from "drizzle-orm";
import { ATS_LIST } from "../adapters/ats";
import { db } from "../db/client";
import { registryCompanies } from "../db/schema";
import { probeBoard, type ProbeHit } from "./atsProbe";
import { slugVariants } from "./slugs";

export { nameSlugs, slugVariants } from "./slugs";

/**
 * Finds public ATS boards for companies the user named that are not in the registry,
 * by probing likely board slugs on every supported ATS. Detected boards join the registry
 * (origin auto_detected, no tags), so discovery can use them and later runs skip the probe.
 */

type Probe = typeof probeBoard;

/** The first board with postings among all slug variants and ATSs, probed in parallel per variant. */
export async function detectBoard(name: string, opts: { userAgent: string; probe?: Probe }): Promise<ProbeHit | null> {
  const probe = opts.probe ?? probeBoard;
  for (const slug of slugVariants(name)) {
    const hits = await Promise.all(ATS_LIST.map((ats) => probe(ats, slug, { userAgent: opts.userAgent, timeoutMs: 8000 })));
    const hit = hits.filter((h): h is ProbeHit => h !== null && h.jobCount > 0).sort((a, b) => b.jobCount - a.jobCount)[0];
    if (hit) return hit;
  }
  return null;
}

/** Detects boards for `names` and records them in the registry; returns what was found. */
export async function autoDetectCompanies(names: string[], opts: { userAgent: string; probe?: Probe }) {
  const found: Array<{ name: string; hit: ProbeHit }> = [];
  await Promise.all(
    names.map(async (name) => {
      const hit = await detectBoard(name, opts);
      if (hit) found.push({ name, hit });
    }),
  );
  // Two names can lead to one board ("Acme", "Acme Inc"); one upsert may not touch a row twice.
  const boards = [...new Map(found.map((f) => [`${f.hit.ats}:${f.hit.slug}`, f])).values()];
  if (boards.length) {
    await db
      .insert(registryCompanies)
      .values(
        boards.map(({ name, hit }) => ({
          name,
          ats: hit.ats,
          slug: hit.slug,
          tags: [],
          origin: "auto_detected" as const,
          jobCount: hit.jobCount,
          verifiedAt: new Date(),
        })),
      )
      .onConflictDoUpdate({
        target: [registryCompanies.ats, registryCompanies.slug],
        set: { jobCount: sql`excluded.job_count`, verifiedAt: sql`excluded.verified_at` },
      });
  }
  return { found, missing: names.filter((n) => !found.some((f) => f.name === n)) };
}
