import { genericPack } from "./generic";
import { jobsPack } from "./jobs";
import type { DomainPack } from "./types";

/** Every domain pack, in the order the compile prompt lists them; generic takes whatever the others don't. */
export const PACKS: readonly DomainPack[] = [jobsPack, genericPack];
