import { detectArrangement, type WorkArrangement } from "./remote";
import { parseSalary, type SalaryRange } from "./salary";

/**
 * Parser for the header line of Hacker News "Who is hiring?" posts, which by convention
 * reads "Company | Role | Location | Remote | Full-time | Salary | URL" in any order.
 * Each segment is classified on its own; the first segment is the company.
 * Returns null when the line is not structured enough, so the LLM rung can take over.
 */

export type SegmentKind = "company" | "url" | "salary" | "role" | "arrangement" | "employment" | "location" | "other";

export interface HnHeader {
  company: string;
  role: string | null;
  location: string | null;
  arrangement: WorkArrangement | null;
  salary: SalaryRange | null;
  employment: string | null;
  url: string | null;
  /** Every segment with its classification and original text (used as evidence). */
  segments: Array<{ text: string; kind: SegmentKind }>;
}

const URL_RE = /\bhttps?:\/\/[^\s|)]+/i;
const ROLE_RE =
  /\b(engineers?|developers?|scientists?|researchers?|designers?|managers?|lead|head of|architects?|sre|devops|swe|analysts?|operators?|founding|staff|principal|interns?|roles?|positions?|openings?|cto|vp)\b/i;
const EMPLOYMENT_RE = /\b(full[- ]?time|part[- ]?time|contract(or)?|intern(ship)?|freelance|b2b|permanent)\b/i;

export function parseHnHeader(line: string): HnHeader | null {
  const parts = line
    .split("|")
    .map((s) => s.replace(/\*/g, "").trim())
    .filter(Boolean);
  if (parts.length < 3) return null;

  const [companyText, ...rest] = parts;
  const company = companyText!.replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (!company || company.length > 80) return null;

  const segments: HnHeader["segments"] = [{ text: companyText!, kind: "company" }];
  const header: HnHeader = { company, role: null, location: null, arrangement: null, salary: null, employment: null, url: null, segments };

  for (const text of rest) {
    const kind = classify(text, header);
    segments.push({ text, kind });
    switch (kind) {
      case "url":
        header.url = text.match(URL_RE)![0];
        break;
      case "salary":
        header.salary = parseSalary(text);
        break;
      case "role":
        header.role = header.role ? `${header.role}; ${text}` : text;
        break;
      case "arrangement":
        header.arrangement = detectArrangement(text);
        // "Remote (Europe)" or "Chicago, IL / Remote" also say where.
        if (!header.location && hasPlace(text)) header.location = text;
        break;
      case "employment":
        header.employment = text;
        break;
      case "location":
        header.location = text;
        break;
    }
  }

  // A header with none of role, location or arrangement is probably prose, not a header.
  if (!header.role && !header.location && !header.arrangement) return null;
  return header;
}

function classify(text: string, header: HnHeader): SegmentKind {
  if (URL_RE.test(text) && !header.url) return "url";
  if (!header.salary && parseSalary(text)) return "salary";
  if (ROLE_RE.test(text)) return "role";
  if (detectArrangement(text)) return "arrangement";
  if (EMPLOYMENT_RE.test(text) && text.length < 60) return "employment";
  if (!header.location && text.length < 80) return "location";
  return "other";
}

/** True if an arrangement segment also names somewhere ("Remote (US)", "NYC or Remote"). */
function hasPlace(text: string): boolean {
  const withoutArrangement = text.replace(/\b(fully|remote|hybrid|on[\s-]?site|wfh|work from home|only|preferred|possible|friendly|ok)\b/gi, "");
  return /[a-z]{2,}/i.test(withoutArrangement.replace(/[()/,+&-]|\bor\b|\band\b/gi, ""));
}
