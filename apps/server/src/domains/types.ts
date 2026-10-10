import type { DatasetContract } from "@repo/contracts";

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
}

export interface NormalizeContext {
  /** The user's request, in their words. */
  prompt: string;
  /** Says what a default changed, for the run's log. */
  warnings: string[];
}
