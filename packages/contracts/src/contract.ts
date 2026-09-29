import { z } from "zod";

/**
 * The Dataset Contract: what the user actually asked for, in machine-readable form.
 * Every later stage works from this, never from the raw prompt.
 *
 * This schema is sent to the LLM as a strict structured output, so it must stay
 * strict-mode safe: object root, every field required (use nullable), no records or min/max.
 */

/** Known fields for the job_posting entity; adapters map their data onto these keys. */
export const JOB_CATALOG = [
  "company",
  "title",
  "location",
  "remote",
  "salary",
  "url",
  "department",
  "employment_type",
  "posted_at",
  "description",
  "match_reason",
] as const;
export const CatalogKey = z.enum([...JOB_CATALOG, "custom"]);
export type CatalogKey = z.infer<typeof CatalogKey>;

export const FieldType = z.enum(["string", "url", "boolean", "date", "number", "money_range", "string_list"]);

export const FieldSpec = z.object({
  name: z.string().describe("snake_case column name"),
  catalogKey: CatalogKey,
  type: FieldType,
  required: z.boolean(),
  description: z.string(),
});
export type FieldSpec = z.infer<typeof FieldSpec>;

export const Criterion = z.object({
  id: z.string(),
  label: z.string().describe("Short human label, shown as a signal chip"),
  kind: z.enum(["keyword_any", "keyword_none", "regex", "equals", "company_tag", "semantic"]),
  fields: z.array(z.string()).describe("Contract field names this criterion inspects"),
  values: z.array(z.string()).describe("Keywords, tags, a regex, or the semantic question"),
  strength: z.enum(["hard", "soft"]).describe("hard = must pass; soft = preference that adds to the score"),
  weight: z.number().describe("0..1, only meaningful for soft criteria"),
});
export type Criterion = z.infer<typeof Criterion>;

/** An explicit interpretation of a vague phrase, e.g. "good companies". Users can edit these. */
export const Assumption = z.object({
  phrase: z.string(),
  interpretation: z.string(),
  signals: z.array(z.string()),
});
export type Assumption = z.infer<typeof Assumption>;

export const SourceHints = z.object({
  companies: z.array(z.string()),
  excludeCompanies: z.array(z.string()),
  companyTags: z.array(z.string()),
  urls: z.array(z.string()),
  /** Web searches that should find pages listing these records (used when no known source covers them). */
  searchQueries: z.array(z.string()),
  includeCommunityBoards: z.boolean(),
});
export type SourceHints = z.infer<typeof SourceHints>;

export const DatasetContract = z.object({
  entity: z.enum(["job_posting", "other"]),
  entityDescription: z.string(),
  title: z.string().describe("Short name for the dataset"),
  fields: z.array(FieldSpec),
  criteria: z.array(Criterion),
  assumptions: z.array(Assumption),
  dedupKeys: z.array(z.array(z.string())).describe("Alternative field combinations that identify one entity"),
  sourceHints: SourceHints,
  maxRecords: z.number(),
  unsupported: z.array(z.string()).describe("Parts of the request RUVO cannot satisfy"),
  /** Sensitive personal attributes the request filters on (e.g. sexual orientation); only self-described public statements count. */
  sensitive: z.array(z.string()),
});
export type DatasetContract = z.infer<typeof DatasetContract>;
