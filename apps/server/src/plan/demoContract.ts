import type { DatasetContract } from "@repo/contracts";

/**
 * The PRD's flagship request and its hand-written contract. Used as the template
 * contract until the requirement compiler runs, and as a stable fixture in tests.
 */
export const DEMO_PROMPT =
  "Find me backend + AI engineering roles, preferably remote, from good technology companies. " +
  "Return company, title, location, salary if available, job URL, and why the role matches.";

export const DEMO_CONTRACT: DatasetContract = {
  entity: "job_posting",
  entityDescription: "Open job postings for backend and AI engineering roles",
  title: "Backend + AI engineering roles",
  fields: [
    { name: "company", catalogKey: "company", type: "string", required: true, description: "Hiring company" },
    { name: "title", catalogKey: "title", type: "string", required: true, description: "Job title" },
    { name: "location", catalogKey: "location", type: "string", required: true, description: "Where the role is based" },
    { name: "remote", catalogKey: "remote", type: "string", required: false, description: "remote, hybrid or onsite" },
    { name: "salary", catalogKey: "salary", type: "money_range", required: false, description: "Pay range if published" },
    { name: "url", catalogKey: "url", type: "url", required: true, description: "Link to the posting" },
    { name: "department", catalogKey: "department", type: "string", required: false, description: "Team or department" },
    { name: "posted_at", catalogKey: "posted_at", type: "date", required: false, description: "When the posting was published" },
  ],
  criteria: [
    {
      id: "role_family",
      label: "Backend / AI engineering role",
      kind: "keyword_any",
      fields: ["title"],
      values: [
        "backend", "back-end", "back end", "platform", "infrastructure", "infra", "distributed", "inference",
        "llm", "machine learning engineer", "ml engineer", "ai engineer", "applied ai", "agent", "api",
        "systems engineer", "software engineer", "research engineer",
      ],
      strength: "hard",
      weight: 1,
    },
    {
      id: "not_other_function",
      label: "Not a non-engineering or frontend role",
      kind: "keyword_none",
      fields: ["title"],
      values: [
        "frontend", "front-end", "front end", "designer", "recruit", "sales", "account executive",
        "marketing", "legal", "counsel", "finance", "intern", "manager", "director", "go-to-market",
      ],
      strength: "hard",
      weight: 1,
    },
    { id: "remote_preferred", label: "Remote", kind: "equals", fields: ["remote"], values: ["remote"], strength: "soft", weight: 0.5 },
    {
      id: "good_company",
      label: "AI / infra / devtools company",
      kind: "company_tag",
      fields: ["company"],
      values: ["ai_lab", "ai_infra", "devtools"],
      strength: "soft",
      weight: 0.3,
    },
  ],
  assumptions: [
    {
      phrase: "good technology companies",
      interpretation: "Companies in RUVO's curated registry tagged as AI labs, AI infrastructure or developer tools",
      signals: ["registry tag: ai_lab / ai_infra / devtools"],
    },
    {
      phrase: "currently open",
      interpretation: "Listed on the company's public job board at collection time",
      signals: ["present in the ATS job-board API"],
    },
  ],
  dedupKeys: [["url"], ["company", "title", "location"]],
  sourceHints: { companies: [], excludeCompanies: [], companyTags: ["ai_lab", "ai_infra", "devtools"], urls: [], searchQueries: [], includeCommunityBoards: false },
  maxRecords: 500,
  unsupported: [],
  sensitive: [],
};
