export type WorkArrangement = "remote" | "hybrid" | "onsite";

/**
 * Detects the work arrangement from free text such as a location string or job header.
 * Hybrid wins over remote ("remote-friendly hybrid"), and explicit negations
 * ("no remote", "not remote") mean onsite. Returns null when nothing is stated.
 */
export function detectArrangement(text: string): WorkArrangement | null {
  const t = text.toLowerCase();
  if (/\bhybrid\b/.test(t)) return "hybrid";
  if (/\b(?:no|not|non)[\s-]+remote\b/.test(t)) return "onsite";
  if (/\b(?:remote|wfh|work from home|work from anywhere|distributed|anywhere)\b/.test(t)) return "remote";
  if (/\b(?:on[\s-]?site|in[\s-]office|in person|office[\s-]based)\b/.test(t)) return "onsite";
  return null;
}

/** Maps ATS workplace-type values (Ashby "OnSite", Lever "onsite", "unspecified", …). */
export function arrangementFromWorkplaceType(value: string | null | undefined): WorkArrangement | null {
  const v = (value ?? "").toLowerCase().replace(/[\s_-]/g, "");
  if (v === "remote") return "remote";
  if (v === "hybrid") return "hybrid";
  if (v === "onsite" || v === "inoffice" || v === "office") return "onsite";
  return null;
}
