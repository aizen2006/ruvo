import type { EvidenceMethod } from "@repo/contracts";
import clsx from "clsx";

/** Plain names for extraction methods, grouped into trust tiers by colour. */
const METHOD: Record<EvidenceMethod, { label: string; tier: string }> = {
  API: { label: "Source API", tier: "bg-structured-wash text-structured" },
  JSON_LD: { label: "Structured data", tier: "bg-structured-wash text-structured" },
  EMBEDDED_JSON: { label: "Page data", tier: "bg-structured-wash text-structured" },
  DOM: { label: "Page layout", tier: "bg-pattern-wash text-pattern" },
  REGEX: { label: "Text pattern", tier: "bg-pattern-wash text-pattern" },
  LLM: { label: "AI extraction", tier: "bg-model-wash text-model" },
  SEARCH: { label: "Search result", tier: "bg-model-wash text-model" },
  DERIVED: { label: "Derived", tier: "bg-derived-wash text-derived" },
};

export const methodLabel = (m: EvidenceMethod) => METHOD[m].label;

export function MethodBadge({ method }: { method: EvidenceMethod }) {
  return <span className={clsx("inline-block rounded px-1.5 py-0.5 text-xs font-medium", METHOD[method].tier)}>{METHOD[method].label}</span>;
}
