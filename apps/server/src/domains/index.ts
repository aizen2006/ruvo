import type { DatasetContract } from "@repo/contracts";
import { genericPack } from "./generic";
import { jobsPack } from "./jobs";
import type { DomainPack } from "./types";

/** Every domain pack, in the order the compile prompt lists them; generic takes whatever the others don't. */
export const PACKS: readonly DomainPack[] = [jobsPack, genericPack];

/** The domains a contract may name, as the compiler's schema offers them. */
export const DOMAINS = PACKS.map((p) => p.id) as [string, ...string[]];

/** The pack that knows a contract's kind of record; a domain no pack has is read as generic. */
export const packOf = (contract: Pick<DatasetContract, "domain">): DomainPack => PACKS.find((p) => p.id === contract.domain) ?? genericPack;
