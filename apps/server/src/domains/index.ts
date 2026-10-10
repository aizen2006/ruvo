import type { DatasetContract } from "@repo/contracts";
import { genericPack } from "./generic";
import { jobsPack } from "./jobs";
import type { DomainPack, FieldParser } from "./types";

/** Every domain pack, in the order the compile prompt lists them; generic takes whatever the others don't. */
export const PACKS: readonly DomainPack[] = [jobsPack, genericPack];

/** The domains a contract may name, as the compiler's schema offers them. */
export const DOMAINS = PACKS.map((p) => p.id) as [string, ...string[]];

/** The pack that knows a contract's kind of record; a domain no pack has is read as generic. */
export const packOf = (contract: Pick<DatasetContract, "domain">): DomainPack => PACKS.find((p) => p.id === contract.domain) ?? genericPack;

/** How the contract's domain parses a catalog field's values, if it does (a job's arrangement or pay). */
export function parserOf(contract: Pick<DatasetContract, "domain">, catalogKey: string): FieldParser | undefined {
  const { parsers } = packOf(contract);
  return parsers && Object.hasOwn(parsers, catalogKey) ? parsers[catalogKey] : undefined;
}
