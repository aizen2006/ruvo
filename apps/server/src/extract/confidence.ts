import type { EvidenceMethod } from "@repo/contracts";

/** Prior trust in each extraction method; structured sources beat inference. */
const METHOD_PRIOR: Record<EvidenceMethod, number> = {
  API: 0.99,
  JSON_LD: 0.95,
  EMBEDDED_JSON: 0.93,
  DOM: 0.88,
  REGEX: 0.8,
  LLM: 0.75,
  DERIVED: 0.85,
};

/** Confidence in one field value: the method prior, or zero if its quote couldn't be verified. */
export const fieldConfidence = (method: EvidenceMethod, verified: boolean) => (verified ? METHOD_PRIOR[method] : 0);
