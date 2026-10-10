import type { DatasetContract } from "@repo/contracts";
import type { SourceCandidate, SourceLookUp } from "../types";
import { autoDetectCompanies } from "./atsDetect";
import { listRegistry, type RegistryCompany } from "./registry";
import { nameSlugs } from "./slugs";

/** A company name or board slug as lowercase letters and digits, so "Scale AI" matches scaleai. */
export const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Whether the contract leaves this company out, by its name or its board's slug. */
export const isExcluded = (contract: DatasetContract, company: { name: string; slug: string }) =>
  contract.sourceHints.excludeCompanies.some((x) => normalize(x) === normalize(company.name) || normalize(x) === normalize(company.slug));

/** Hacker News's monthly "Who is hiring?" thread, for requests that want community boards. */
const HN_WHO_IS_HIRING: SourceCandidate = {
  ref: "hn_whoishiring:latest",
  adapter: "hn_whoishiring",
  label: "Hacker News: Who is hiring?",
  params: { thread: "latest" },
  tags: [],
  jobCount: null,
  reason: "Community job board requested",
  origin: "community",
};

/**
 * The job sources RUVO knows for a request: registry companies (see registrySources), and the
 * Hacker News board when the request asks for community boards. With `lookUp` (preparing a run),
 * the public boards of named companies the registry lacks are looked for first, and join it.
 */
export async function knownJobSources(contract: DatasetContract, lookUp?: SourceLookUp): Promise<SourceCandidate[]> {
  const known = registrySources(contract, await listRegistry());
  let candidates = known.candidates;
  if (lookUp && known.unmatched.length) {
    const { found, missing } = await autoDetectCompanies(known.unmatched, { userAgent: lookUp.userAgent });
    for (const { name, hit } of found) {
      lookUp.emit({ type: "discovery.detected", message: `Found a ${hit.ats} job board for ${name} (${hit.jobCount} postings)` });
    }
    if (missing.length) lookUp.emit({ type: "discovery.not_found", level: "warn", message: `No public job board found for ${missing.join(", ")}` });
    if (found.length) candidates = registrySources(contract, await listRegistry()).candidates;
  }
  return contract.sourceHints.includeCommunityBoards ? [...candidates, HN_WHO_IS_HIRING] : candidates;
}

/**
 * The registry companies that fit a job request: the ones it names; otherwise, unless the user
 * linked pages, the companies carrying the requested tags, or all of them. Names with no known
 * board come back as `unmatched` (candidates for board detection).
 */
export function registrySources(contract: DatasetContract, registry: RegistryCompany[]): { candidates: SourceCandidate[]; unmatched: string[] } {
  const hints = contract.sourceHints;
  const companies = registry.filter((c) => !isExcluded(contract, c));

  const named = hints.companies.map((name) => ({
    name,
    // "OpenAI Inc" still matches the registry's OpenAI (slug "openai").
    match: companies.find((c) => normalize(c.name) === normalize(name) || normalize(c.slug) === normalize(name) || nameSlugs(name).includes(c.slug)),
  }));
  const wantedTags = new Set([
    ...hints.companyTags,
    ...contract.criteria.filter((c) => c.kind === "company_tag").flatMap((c) => c.values),
  ]);

  let selected: Array<{ company: RegistryCompany; reason: string }>;
  if (named.some((n) => n.match)) {
    selected = named.filter((n) => n.match).map((n) => ({ company: n.match!, reason: `Named in the request` }));
  } else if (hints.urls.length > 0) {
    // "Jobs listed on <url>" means that page; adding the registry would only dilute it.
    selected = [];
  } else if (wantedTags.size > 0) {
    selected = companies
      .filter((c) => c.tags.some((t) => wantedTags.has(t)))
      .map((c) => ({ company: c, reason: `Registry tags: ${c.tags.filter((t) => wantedTags.has(t)).join(", ")}` }));
  } else {
    selected = companies.map((c) => ({ company: c, reason: "Curated registry company" }));
  }
  return {
    candidates: selected.map(({ company, reason }) => registryCandidate(company, reason)),
    unmatched: named.filter((n) => !n.match).map((n) => n.name),
  };
}

/**
 * A registry company as a plannable source: its public board page (browser + recipe) when the
 * registry lists one, otherwise its ATS API.
 */
export function registryCandidate(company: RegistryCompany, reason: string): SourceCandidate {
  if (company.boardUrl) {
    return {
      ref: `html_list:${company.boardUrl}`,
      adapter: "html_list",
      label: company.name,
      params: { url: company.boardUrl, company: company.name, tags: company.tags },
      tags: company.tags,
      jobCount: company.jobCount,
      reason,
      origin: "registry",
    };
  }
  return {
    ref: `${company.ats}:${company.slug}`,
    adapter: company.ats,
    label: company.name,
    params: { slug: company.slug, company: company.name, tags: company.tags },
    tags: company.tags,
    jobCount: company.jobCount,
    reason,
    origin: "registry",
  };
}
