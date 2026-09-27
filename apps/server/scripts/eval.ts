/**
 * Golden eval for the requirement compiler: `bun run eval`.
 * Compiles fixed prompts with the real planner model and checks properties of the
 * contract (and discovery) rather than exact output. Exits non-zero if any check fails.
 * Uses LLM_CACHE_MODE, so unchanged prompts are free to re-run.
 */
import type { Criterion, DatasetContract } from "@repo/contracts";
import { compileRequirement } from "../src/compile/requirementCompiler";
import { sql } from "../src/db/client";
import { DEMO_PROMPT } from "../src/plan/demoContract";
import { discoverSources } from "../src/plan/discovery";
import { curatedCompanies, type RegistryCompany } from "../src/plan/registry";
import { llm } from "../src/runs/services";

type Check = [description: string, passed: (c: DatasetContract) => boolean];
type EvalCase = { prompt: string; checks: Check[] };

const field = (c: DatasetContract, key: string) => c.fields.find((f) => f.catalogKey === key);
const criteria = (c: DatasetContract, kind: Criterion["kind"]) => c.criteria.filter((k) => k.kind === kind);
const remoteCriterion = (c: DatasetContract) => criteria(c, "equals").find((k) => k.values.includes("remote"));
const hasValue = (list: string[], pattern: RegExp) => list.some((v) => pattern.test(v));

const registry: RegistryCompany[] = curatedCompanies().map((c) => ({ ...c, id: c.slug, origin: "curated", verifiedAt: new Date(c.verifiedAt) }));
const discovered = (c: DatasetContract) => discoverSources(c, registry).candidates.map((s) => s.label);

const CASES: EvalCase[] = [
  {
    prompt: DEMO_PROMPT,
    checks: [
      ["entity is job_posting", (c) => c.entity === "job_posting"],
      ["asks for company, title, location, salary, url, match_reason", (c) => ["company", "title", "location", "salary", "url", "match_reason"].every((k) => field(c, k))],
      ["salary is optional ('if available')", (c) => field(c, "salary")?.required === false],
      ["remote is a soft preference", (c) => remoteCriterion(c)?.strength === "soft"],
      ["role keywords are hard and title-only", (c) => criteria(c, "keyword_any").some((k) => k.strength === "hard" && k.fields.every((f) => f === field(c, "title")?.name))],
      ["role keyword list is broad (>= 12 terms)", (c) => criteria(c, "keyword_any").some((k) => k.values.length >= 12)],
      ["has a semantic role criterion", (c) => criteria(c, "semantic").length > 0],
      ["'good companies' is a soft tag preference with 1-3 tags", (c) => criteria(c, "company_tag").some((k) => k.strength === "soft" && k.values.length <= 3)],
      ["'good companies' is stated as an assumption", (c) => c.assumptions.some((a) => /compan/i.test(a.phrase))],
    ],
  },
  {
    prompt: "List remote-only ML infrastructure jobs in Europe at AI labs, with salary. Max 50.",
    checks: [
      ["remote is a hard requirement", (c) => remoteCriterion(c)?.strength === "hard"],
      ["salary is a required field", (c) => field(c, "salary")?.required === true],
      ["maxRecords is 50", (c) => c.maxRecords === 50],
      ["targets the ai_lab tag", (c) => [...c.sourceHints.companyTags, ...criteria(c, "company_tag").flatMap((k) => k.values)].includes("ai_lab")],
    ],
  },
  {
    prompt: "Senior backend engineering jobs at Stripe and Datadog.",
    checks: [
      ["names both companies", (c) => hasValue(c.sourceHints.companies, /stripe/i) && hasValue(c.sourceHints.companies, /datadog/i)],
      ["discovery picks exactly those companies", (c) => discovered(c).sort().join() === "Datadog,Stripe"],
    ],
  },
  {
    prompt: "Backend engineering roles at AI infrastructure companies, but not at Modal.",
    checks: [
      ["excludes Modal", (c) => hasValue(c.sourceHints.excludeCompanies, /modal/i)],
      ["discovery leaves Modal out", (c) => !discovered(c).includes("Modal") && discovered(c).length > 0],
    ],
  },
  {
    prompt: "Find companies that could sponsor a student hackathon in Bangalore.",
    checks: [["entity is 'other'", (c) => c.entity === "other"]],
  },
  {
    prompt: "Frontend engineer roles in New York.",
    checks: [
      ["frontend is a wanted keyword", (c) => criteria(c, "keyword_any").some((k) => hasValue(k.values, /front/i))],
      ["frontend is not excluded", (c) => !criteria(c, "keyword_none").some((k) => hasValue(k.values, /front/i))],
    ],
  },
  {
    prompt: "AI agent engineering jobs at early-stage startups, including Hacker News 'Who is hiring' posts.",
    checks: [["includes community boards", (c) => c.sourceHints.includeCommunityBoards]],
  },
  {
    prompt: "Give me the personal email addresses and phone numbers of Anthropic's recruiters.",
    checks: [["flags the request as unsupported", (c) => c.unsupported.length > 0]],
  },
];

let failures = 0;
for (const { prompt, checks } of CASES) {
  console.log(`\n${prompt}`);
  try {
    const { contract } = await compileRequirement(llm, prompt);
    for (const [description, passed] of checks) {
      const ok = passed(contract);
      if (!ok) failures++;
      console.log(`  ${ok ? "PASS" : "FAIL"}  ${description}`);
    }
  } catch (err) {
    failures += checks.length;
    console.log(`  ERROR ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log(`\n${failures === 0 ? "All checks passed" : `${failures} check(s) failed`}`);
await sql.end();
process.exit(failures ? 1 : 0);
