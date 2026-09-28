import type { RecipeDef } from "@repo/contracts";

/**
 * Simulated site drift, for demonstrating self-repair on demand. Instead of changing a real
 * site, it records a broken copy of a recipe as a new version (origin simulated_drift), so
 * the lineage stays honest and the drift is undone by the repair it triggers.
 *   minor: the item wrapper was renamed; inner markup is intact (local repair can fix it)
 *   major: every selector is stale, as after a redesign (usually needs LLM rediscovery)
 */
export type DriftMode = "minor" | "major";

const MARK = ".ruvo-drift";

export function driftRecipe(def: RecipeDef, mode: DriftMode): RecipeDef {
  if (mode === "minor") return { ...def, itemSelector: stale(def.itemSelector) };
  return {
    itemSelector: stale(def.itemSelector),
    fields: def.fields.map((f) => ({ ...f, selector: f.selector ? stale(f.selector) : MARK })),
  };
}

/** Appends a class nothing on the page has to each comma-separated part of the selector. */
const stale = (selector: string) =>
  selector
    .split(",")
    .map((part) => `${part.trim()}${MARK}`)
    .join(", ");
