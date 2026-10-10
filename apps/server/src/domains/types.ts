import type { DatasetContract, FoundSource, RunMode } from "@repo/contracts";
import type { SearchHit } from "../adapters/searchHits";

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
  /** What it adds to searching the web for sources (for jobs, the job-board platforms). */
  search?: PackSearch;
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
