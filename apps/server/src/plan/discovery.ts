import type { AdapterId, DatasetContract, FoundSource } from "@repo/contracts";
import { registeredAdapters } from "../adapters";
import { nameSlugs } from "./slugs";
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
  origin: "registry" | "community" | "user_url" | "search";
}

export interface Discovery {
  candidates: SourceCandidate[];
  /** Companies the user named that have no known board (candidates for ATS auto-detection). */
  unmatchedCompanies: string[];
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Chooses candidate sources for a contract: pages the user linked come first, then registry
 * companies (the named ones; otherwise, unless the user linked pages, companies carrying the
 * requested tags, or all of them).
 * Only adapters that are implemented are offered, so plans never reference missing code.
 */
export function discoverSources(contract: DatasetContract, registry: RegistryCompany[]): Discovery {
  const available = new Set(registeredAdapters().map((a) => a.id));
  const hints = contract.sourceHints;
  const excluded = new Set(hints.excludeCompanies.map(normalize));
  const companies = registry.filter((c) => !excluded.has(normalize(c.name)) && !excluded.has(normalize(c.slug)));

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
  if (contract.entity !== "job_posting") {
    // The registry and community boards only hold job postings; other data comes from linked pages.
    selected = [];
  } else if (named.some((n) => n.match)) {
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

  // Linked pages first, so they are planned (and run) before budgets are spent elsewhere.
  const candidates: SourceCandidate[] = available.has("html_list")
    ? hints.urls.map((url) => ({
        ref: `html_list:${url}`,
        adapter: "html_list" as const,
        label: new URL(url).host,
        params: { url },
        tags: [],
        jobCount: null,
        reason: "URL supplied by the user",
        origin: "user_url" as const,
      }))
    : [];
  candidates.push(
    ...selected
      .filter(({ company }) => available.has(company.boardUrl ? "html_list" : company.ats))
      .map(({ company, reason }) => registryCandidate(company, reason)),
  );

  if (contract.entity === "job_posting" && hints.includeCommunityBoards && available.has("hn_whoishiring")) {
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
  return { candidates, unmatchedCompanies: named.filter((n) => !n.match).map((n) => n.name) };
}

/** A source web search found earlier, as a plannable candidate again (e.g. after a contract edit). */
export const foundCandidate = (found: FoundSource): SourceCandidate => ({ ...found, params: found.params as Record<string, unknown>, tags: [], jobCount: null, origin: "search" });

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
