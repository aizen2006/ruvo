import type { AdapterId, DatasetContract, FieldSpec, FoundSource, RunMode } from "@repo/contracts";
import type { SearchHit } from "../adapters/searchHits";
import type { SourceAdapter } from "../adapters/types";
import type { EmitInput } from "../core/run";
import type { ExtractorRung } from "../extract/ladder";

/**
 * What RUVO knows about one kind of record, e.g. job postings. The requirement compiler is told
 * about every pack, and generic code asks a contract's pack instead of checking for jobs.
 */
export interface DomainPack {
  /** How contracts name the domain. */
  id: string;
  /** What requests it is for, as one line in the compile prompt's list of domains. */
  describe: string;
  /** The catalog keys its fields may use, with what each holds. */
  fields: Record<string, string>;
  /** Catalog keys every record needs; normalizing adds the ones a contract lacks. */
  required: string[];
  /** Its own rules in the compile prompt, after its catalog. */
  prompt: string;
  /** Its deterministic defaults for a contract the compiler wrote or a user edited, after the shared clean-up. */
  normalize?(contract: DatasetContract, context: NormalizeContext): DatasetContract;
  /** Source adapters of its own, beside the core ones that read any page (for jobs, the ATS boards and Hacker News). */
  adapters?: SourceAdapter<unknown>[];
  /**
   * Sources it knows for a contract without searching (for jobs, the registry's companies). With
   * `lookUp`, while a run is prepared, it may first look for ones it doesn't know yet.
   */
  knownSources?(contract: DatasetContract, lookUp?: SourceLookUp): Promise<SourceCandidate[]>;
  /** What it adds to searching the web for sources (for jobs, the job-board platforms). */
  search?: PackSearch;
  /** How it reads, checks and compares values of its catalog fields, by key (for jobs: arrangement, pay, place, company). */
  parsers?: Record<string, FieldParser>;
  /** Readers for the schema.org records (JSON-LD) its pages publish, most specific first: the first to find its kind of record on a page reads it. */
  jsonLd?: JsonLdReader[];
  /** Rungs that read its values from free text by pattern (for jobs, pay ranges). */
  regex?: ExtractorRung[];
  /** The catalog key a list page's owner fills when its items don't name it (for jobs, the hiring company on its own board). */
  ownerField?: string;
}

/** How a pack reads, checks and compares one of its fields' values. */
export interface FieldParser {
  /** A value as RUVO keeps it, from a page's or the model's words ("Remote" → "remote"). */
  normalize?(raw: string): string;
  /** Whether a quote states the value, compared as parsed values ("fully remote" states "remote"). */
  supports?(value: string, quote: string): boolean;
  /** The coarse form records share when they are duplicates ("San Francisco, CA; NYC" → "san francisco"). */
  dedupeKey?(value: string): string;
}

/** Reads one kind of schema.org record (JSON-LD) onto a contract's fields. */
export interface JsonLdReader {
  matches(node: Record<string, unknown>): boolean;
  /** A field's value in the record, with the property path it came from. */
  read(node: Record<string, unknown>, field: FieldSpec): { value: string; path: string } | null;
}

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

/** How a pack looks up sources it doesn't know yet while a run is prepared, and tells the run what it found. */
export interface SourceLookUp {
  userAgent: string;
  emit(event: Omit<EmitInput, "stage">): void;
}

/** A pack's part in a run's search rounds: searches of its own, and sources of its own among the hits. */
export interface PackSearch {
  /** New sources of its own that a run's searching may add, by the run's mode. */
  maxNew: Record<RunMode, number>;
  /** Its searches for a round, beside the round's queries for pages: round 1 searches for the request itself, later rounds for new queries. */
  queries(contract: DatasetContract, queries: string[], round: number): string[];
  /** Whether a search hit is its own, so never read as a page. */
  recognize(hit: SearchHit): boolean;
  /** Its new sources among a round's hits: at most `max`, and none `seen` before. */
  sources(contract: DatasetContract, hits: SearchHit[], opts: { seen: ReadonlySet<string>; max: number; userAgent: string }): Promise<FoundSource[]>;
  /** How the run's log sums up the sources it found in a round: "4 more companies on Greenhouse and Lever". */
  summarize(sources: FoundSource[]): string;
}

export interface NormalizeContext {
  /** The user's request, in their words. */
  prompt: string;
  /** Says what a default changed, for the run's log. */
  warnings: string[];
}
