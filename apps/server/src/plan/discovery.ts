import type { AdapterId, DatasetContract } from "@repo/contracts";
import { registeredAdapters } from "../adapters";
import type { RegistryCompany } from "./registry";

/** A source the planner may choose. `ref` is the stable id plans refer to. */
export interface SourceCandidate {
  ref: string;
  adapter: AdapterId;
  label: string;
  params: Record<string, unknown>;
  tags: string[];
  /** Postings at last verification; null when unknown. */
  jobCount: number | null;
  reason: string;
  origin: "registry" | "community" | "user_url";
}

export interface Discovery {
  candidates: SourceCandidate[];
  /** Companies the user named that have no known board (candidates for ATS auto-detection). */
  unmatchedCompanies: string[];
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Chooses candidate sources for a contract from the registry:
 * named companies first; otherwise companies carrying the requested tags; otherwise all.
 * Only adapters that are implemented are offered, so plans never reference missing code.
 */
export function discoverSources(contract: DatasetContract, registry: RegistryCompany[]): Discovery {
  const available = new Set(registeredAdapters().map((a) => a.id));
  const hints = contract.sourceHints;
  const excluded = new Set(hints.excludeCompanies.map(normalize));
  const companies = registry.filter((c) => !excluded.has(normalize(c.name)) && !excluded.has(normalize(c.slug)));

  const named = hints.companies.map((name) => ({
    name,
    match: companies.find((c) => normalize(c.name) === normalize(name) || normalize(c.slug) === normalize(name)),
  }));
  const wantedTags = new Set([
    ...hints.companyTags,
    ...contract.criteria.filter((c) => c.kind === "company_tag").flatMap((c) => c.values),
  ]);

  let selected: Array<{ company: RegistryCompany; reason: string }>;
  if (named.some((n) => n.match)) {
    selected = named.filter((n) => n.match).map((n) => ({ company: n.match!, reason: `Named in the request` }));
  } else if (wantedTags.size > 0) {
    selected = companies
      .filter((c) => c.tags.some((t) => wantedTags.has(t)))
      .map((c) => ({ company: c, reason: `Registry tags: ${c.tags.filter((t) => wantedTags.has(t)).join(", ")}` }));
  } else {
    selected = companies.map((c) => ({ company: c, reason: "Curated registry company" }));
  }

  const candidates: SourceCandidate[] = selected
    .filter(({ company }) => available.has(company.ats))
    .map(({ company, reason }) => registryCandidate(company, reason));

  if (hints.includeCommunityBoards && available.has("hn_whoishiring")) {
    candidates.push({
      ref: "hn_whoishiring:latest",
      adapter: "hn_whoishiring",
      label: "Hacker News: Who is hiring?",
      params: { thread: "latest" },
      tags: [],
      jobCount: null,
      reason: "Community job board requested",
      origin: "community",
    });
  }
  if (available.has("html_list")) {
    for (const url of hints.urls) {
      candidates.push({
        ref: `html_list:${url}`,
        adapter: "html_list",
        label: new URL(url).hostname,
        params: { url },
        tags: [],
        jobCount: null,
        reason: "URL supplied by the user",
        origin: "user_url",
      });
    }
  }

  return { candidates, unmatchedCompanies: named.filter((n) => !n.match).map((n) => n.name) };
}

/** A registry company as a plannable source. */
export function registryCandidate(company: RegistryCompany, reason: string): SourceCandidate {
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
