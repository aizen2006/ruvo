import { sql } from "drizzle-orm";
import { ATS_LIST } from "../adapters/ats";
import { db } from "../db/client";
import { registryCompanies } from "../db/schema";
import { probeBoard, type ProbeHit } from "./atsProbe";

/**
 * Finds public ATS boards for companies the user named that are not in the registry,
 * by probing likely board slugs on every supported ATS. Detected boards join the registry
 * (origin auto_detected, no tags), so discovery can use them and later runs skip the probe.
 */

const SUFFIXES = /\b(inc|llc|ltd|corp|co|labs?|technologies|technology|hq|ai)\b\.?/g;

/** Likely board slugs for a company name, most likely first: "Scale AI" → scaleai, scale-ai, scale. */
export function slugVariants(name: string): string[] {
  const words = name.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(Boolean);
  const core = name.toLowerCase().replace(SUFFIXES, " ").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const variants = [words.join(""), words.join("-"), core.join(""), core.join("-"), core[0] ?? ""];
  return [...new Set(variants.filter((v) => v.length >= 2))];
}

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
  if (found.length) {
    await db
      .insert(registryCompanies)
      .values(
        found.map(({ name, hit }) => ({
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
