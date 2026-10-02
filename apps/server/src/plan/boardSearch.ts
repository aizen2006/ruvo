import type { Criterion, DatasetContract, FoundSource } from "@repo/contracts";
import { ATS_LIST, type Ats } from "../adapters/ats";
import type { SearchHit } from "../adapters/searchHits";
import { itemKeyFor } from "../execute/contractFields";
import { compileKeywords, firstKeywordMatch } from "../execute/keywords";
import { mapLimit } from "../libs/limit";
import { recordBoards, type Probe } from "./atsDetect";
import { probeBoard, type ProbeHit } from "./atsProbe";
import { isExcluded, normalize, registryCandidate } from "./discovery";
import { listRegistry, type RegistryCompany } from "./registry";

/**
 * Job boards found on the web: a posting on an ATS platform RUVO reads (Greenhouse, Ashby,
 * Lever, Workable) names its company's board, which becomes a source read through the ATS API,
 * like a registry company.
 */

/** Where each ATS shows postings: the site to search, and the hosts whose first path segment is a board's slug. */
const BOARD_SITES: Record<Ats, { site: string; hosts: string[] }> = {
  greenhouse: { site: "greenhouse.io", hosts: ["job-boards.greenhouse.io", "boards.greenhouse.io"] },
  ashby: { site: "jobs.ashbyhq.com", hosts: ["jobs.ashbyhq.com"] },
  lever: { site: "jobs.lever.co", hosts: ["jobs.lever.co"] },
  workable: { site: "apply.workable.com", hosts: ["apply.workable.com"] },
};

const PROBE_CONCURRENCY = 8;

/** Results read per board search: a whole page of them, as each can be another company at no extra search. */
export const BOARD_RESULTS = 20;

export const platformName = (ats: Ats) => ats[0]!.toUpperCase() + ats.slice(1);

/** A search for postings on every board platform at once: `Backend Developer (site:greenhouse.io OR site:jobs.ashbyhq.com OR …)`. */
export const boardQuery = (words: string) => `${words} (${ATS_LIST.map((ats) => `site:${BOARD_SITES[ats].site}`).join(" OR ")})`;

/**
 * The role and place a job request asks for, in its own words: the longest role keyword its title
 * uses (else its first role keyword, else the title), then "remote" and the first location its
 * criteria name. "Backend Developer Jobs with AI Focus" → "Backend Developer".
 */
export function roleWords(contract: DatasetContract): string {
  const on = (key: string, kinds: Array<Criterion["kind"]>) =>
    contract.criteria.filter((c) => kinds.includes(c.kind) && c.fields.some((f) => itemKeyFor(contract, f) === key));
  const keywords = on("title", ["keyword_any"]).filter((c) => c.strength === "hard").flatMap((c) => c.values);
  const role = firstKeywordMatch(compileKeywords([...keywords].sort((a, b) => b.length - a.length)), contract.title) ?? keywords[0] ?? contract.title;
  const remote = on("remote", ["equals"]).some((c) => c.values.some((v) => v.toLowerCase() === "remote"));
  const location = on("location", ["equals", "keyword_any"])[0]?.values[0];
  return [role, remote && "remote", location].filter(Boolean).join(" ");
}

/**
 * The board a posting's URL belongs to: job-boards.greenhouse.io/acme/jobs/1 → greenhouse, acme.
 * Slugs are lowercased, as the registry keeps them: Greenhouse and Ashby ignore case, and Lever
 * and Workable slugs are lowercase.
 */
export function boardOf(raw: string): { ats: Ats; slug: string } | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const ats = ATS_LIST.find((a) => BOARD_SITES[a].hosts.includes(url.hostname));
  const slug = url.pathname.split("/")[1]?.toLowerCase();
  return ats && slug ? { ats, slug } : null;
}

interface Board {
  ats: Ats;
  slug: string;
  name: string;
  /** The search that found the board's first posting. */
  query: string;
  /** Its registry entry, when the registry knows the board. */
  company?: RegistryCompany;
  hit?: ProbeHit | null;
}

/**
 * The job boards behind the postings in `hits`, as sources shaped like registry companies. Boards
 * whose source is already `seen`, or whose company the contract excludes, are skipped. Registry
 * boards are verified already; the others are checked with the board probe, a batch at a time
 * until `max` boards are kept, and join the registry, so later runs know them.
 */
export async function boardsFromHits(
  contract: DatasetContract,
  hits: SearchHit[],
  opts: { seen: ReadonlySet<string>; max: number; userAgent: string; probe?: Probe },
): Promise<FoundSource[]> {
  // Each board once, in the order search found it, with its postings' titles (they name the company).
  const found = new Map<string, { ats: Ats; slug: string; query: string; titles: string[] }>();
  for (const hit of hits) {
    const board = boardOf(hit.url);
    if (!board) continue;
    const key = `${board.ats}:${board.slug}`;
    if (!found.has(key)) found.set(key, { ...board, query: hit.query, titles: [] });
    found.get(key)!.titles.push(hit.title);
  }

  const registry = await listRegistry();
  const queue = [...found.values()].flatMap(({ ats, slug, query, titles }): Board[] => {
    const company = registry.find((c) => c.ats === ats && c.slug === slug);
    const name = company?.name ?? companyName(slug, titles);
    const ref = company ? registryCandidate(company, "").ref : `${ats}:${slug}`;
    return opts.seen.has(ref) || isExcluded(contract, { name, slug }) ? [] : [{ ats, slug, name, query, company }];
  });

  const probe = opts.probe ?? probeBoard;
  const kept: Board[] = [];
  while (kept.length < opts.max && queue.length > 0) {
    const batch = queue.splice(0, opts.max - kept.length);
    await mapLimit(batch, PROBE_CONCURRENCY, async (b) => {
      if (!b.company) b.hit = await probe(b.ats, b.slug, { userAgent: opts.userAgent });
    });
    kept.push(...batch.filter((b) => b.company || (b.hit?.jobCount ?? 0) > 0));
  }

  const recorded = await recordBoards(kept.flatMap((b) => (b.hit ? [{ name: b.name, hit: b.hit }] : [])));
  return kept.map((b) => {
    const company = b.company ?? recorded.find((r) => r.ats === b.ats && r.slug === b.slug)!;
    const postings = company.jobCount ? ` with ${company.jobCount} postings` : "";
    const { ref, adapter, label, params, reason } = registryCandidate(company, `Job board on ${platformName(b.ats)}${postings}, found by searching "${b.query}"`);
    return { ref, adapter, label, params, reason };
  });
}

/**
 * The company's name as its postings' titles write it: the longest title part that starts or ends
 * with the board's slug, or that the slug starts with ("Backend Engineer @ Monte Carlo - Jobs" on
 * the board montecarlodata → Monte Carlo). Otherwise the slug in words: weekday-1 → Weekday.
 */
function companyName(slug: string, titles: string[]): string {
  const words = slug.replace(/-\d+$/, "").split(/[-_]+/);
  const key = normalize(words.join(""));
  const fits = (part: string) => {
    const n = normalize(part);
    return n === key || (Math.min(n.length, key.length) >= 3 && (n.startsWith(key) || n.endsWith(key) || key.startsWith(n)));
  };
  const named = titles.flatMap((t) => t.split(/\s+(?:[-–—|@]|at)\s+/)).filter(fits).sort((a, b) => b.length - a.length)[0];
  // Search engines cut long titles short with "...".
  return named?.replace(/\s*(?:\.\.\.|…)$/, "").trim() ?? words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
