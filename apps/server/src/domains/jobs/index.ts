import { bulletList } from "../../libs/text";
import type { DomainPack } from "../types";
import { boardSearch } from "./boards";
import { COMPANY_TAG_GUIDE, JOB_FIELD_GUIDE } from "./fields";
import { normalizeJobs } from "./normalize";

/** Job postings: the deep domain, read from job boards RUVO knows, boards found by search, and job pages. */
export const jobsPack: DomainPack = {
  id: "jobs",
  describe: "requests about jobs, roles, openings or hiring",
  fields: JOB_FIELD_GUIDE,
  required: ["company", "title", "url"],
  prompt: `keyword_any: use it for role families. A hard role keyword criterion is a broad recall filter applied to the title field only (descriptions mention every technology, so never use description for role keywords). List 20-35 short title stems and synonyms so good roles are not dropped, e.g. for backend + AI: "backend", "back-end", "platform", "infra", "distributed", "systems", "api", "software engineer", "member of technical staff", "research engineer", "ml engineer", "machine learning", "ai engineer", "applied ai", "llm", "inference", "agents". Precision comes from the semantic criterion and exclusions, not from a short keyword list.
keyword_none: also for obviously different functions (sales, recruiting, design…).
equals: for work arrangement use field "remote" with values from "remote", "hybrid", "onsite".
semantic: e.g. "Is this a backend or AI-infrastructure engineering role?". Add one alongside keyword role criteria so ambiguous titles are judged by meaning.
company_tag registry tags:
${bulletList(COMPANY_TAG_GUIDE)}
searchQueries: leave empty (RUVO uses its job-board registry).`,
  normalize: normalizeJobs,
  search: boardSearch,
};
