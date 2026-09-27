import { ATS_BOARD_URL, ATS_LIST, countPostings, type Ats } from "../adapters/ats";

export interface ProbeHit {
  ats: Ats;
  slug: string;
  jobCount: number;
}

/**
 * Checks whether `slug` has a public board on `ats` and how many postings it lists.
 * Returns null when the board doesn't exist or can't be read in time.
 */
export async function probeBoard(ats: Ats, slug: string, opts: { userAgent: string; timeoutMs?: number }): Promise<ProbeHit | null> {
  try {
    const res = await fetch(ATS_BOARD_URL[ats](slug), {
      headers: { "user-agent": opts.userAgent, accept: "application/json" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
    if (!res.ok) return null;
    return { ats, slug, jobCount: countPostings(await res.json()) };
  } catch {
    return null;
  }
}

/**
 * Tries each ATS for a slug (preferred first) and returns the first board that lists postings.
 * Used to verify the curated registry and to auto-detect boards for companies named in a prompt.
 */
export async function findBoard(slug: string, opts: { userAgent: string; prefer?: Ats; timeoutMs?: number }): Promise<ProbeHit | null> {
  const order = opts.prefer ? [opts.prefer, ...ATS_LIST.filter((a) => a !== opts.prefer)] : [...ATS_LIST];
  for (const ats of order) {
    const hit = await probeBoard(ats, slug, opts);
    if (hit && hit.jobCount > 0) return hit;
  }
  return null;
}
