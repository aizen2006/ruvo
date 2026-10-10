import { beforeEach, describe, expect, test } from "bun:test";
import type { DatasetContract } from "@repo/contracts";
import { isSafeRegex, normalizeContract } from "../src/compile/normalize";
import { COMPILE_SYSTEM_PROMPT } from "../src/compile/prompt";
import { compileRequirement } from "../src/compile/requirementCompiler";
import { PACKS } from "../src/domains";
import { bulletList } from "../src/libs/text";
import { createLlmClient } from "../src/llm/client";
import { DEMO_CONTRACT, DEMO_PROMPT } from "../src/plan/demoContract";
import { resetDb } from "./helpers/db";
import { fakeResponses } from "./helpers/fakeLlm";

const base: DatasetContract = {
  ...DEMO_CONTRACT,
  fields: [
    { name: "Company Name", catalogKey: "company", type: "string", required: true, description: "" },
    { name: "title", catalogKey: "title", type: "string", required: true, description: "" },
    { name: "title", catalogKey: "custom", type: "string", required: false, description: "duplicate name" },
    { name: "location", catalogKey: "location", type: "string", required: false, description: "" },
  ],
  criteria: [],
  assumptions: [],
  dedupKeys: [],
};

describe("normalizeContract", () => {
  test("snake-cases and de-duplicates field names, adding missing required fields", () => {
    const { contract, warnings } = normalizeContract(base, "backend jobs");
    expect(contract.fields.map((f) => f.name)).toEqual(["company_name", "title", "title_2", "location", "url"]);
    expect(warnings).toContain('Added missing "url" field');
  });

  test("maps catalog keys in criteria to field names and drops unusable criteria", () => {
    const { contract, warnings } = normalizeContract(
      {
        ...base,
        criteria: [
          { id: "Role Family", label: "Role", kind: "keyword_any", fields: ["title"], values: ["backend", " "], strength: "hard", weight: 0.2 },
          { id: "co", label: "Company", kind: "keyword_none", fields: ["company"], values: ["Acme"], strength: "hard", weight: 1 },
          { id: "bad", label: "Bad regex", kind: "regex", fields: ["title"], values: ["(unclosed"], strength: "hard", weight: 1 },
          { id: "empty", label: "Empty", kind: "keyword_any", fields: ["title"], values: [], strength: "soft", weight: 1 },
          { id: "arr", label: "Remote", kind: "equals", fields: ["work_mode"], values: ["remote"], strength: "soft", weight: 5 },
        ],
      },
      "backend jobs",
    );
    expect(contract.criteria.map((c) => [c.id, c.fields, c.values])).toEqual([
      ["role_family", ["title"], ["backend"]],
      ["co", ["company_name"], ["Acme"]],
    ]);
    expect(contract.criteria[0]!.weight).toBe(1);
    expect(warnings.filter((w) => w.startsWith("Dropped"))).toHaveLength(3);
  });

  test("adds an optional catalog field that an equals criterion checks, instead of dropping the criterion", () => {
    const remote = { id: "remote", label: "Remote preferred", kind: "equals" as const, fields: ["remote"], values: ["remote"], strength: "soft" as const, weight: 0.9 };
    const { contract, warnings } = normalizeContract({ ...base, criteria: [remote] }, "backend jobs, preferably remote");
    expect(contract.fields.find((f) => f.name === "remote")).toMatchObject({ catalogKey: "remote", type: "string", required: false });
    expect(contract.criteria.map((c) => [c.id, c.fields])).toEqual([["remote", ["remote"]]]);
    expect(warnings).toContain('Added optional "remote" field for criterion "Remote preferred"');
  });

  test('injects the "good companies" interpretation when the model left it out', () => {
    const { contract } = normalizeContract(base, "Backend roles at good technology companies");
    expect(contract.criteria.find((c) => c.kind === "company_tag")?.strength).toBe("soft");
    expect(contract.assumptions[0]?.phrase).toBe("good companies");
  });

  test("makes a column custom when its domain's catalog lacks its key, and reads an unknown domain as generic", () => {
    const seniority = { name: "seniority", catalogKey: "seniority", type: "string" as const, required: false, description: "" };
    const jobs = normalizeContract({ ...base, fields: [...base.fields, seniority] }, "backend jobs");
    expect(jobs.contract.fields.find((f) => f.name === "seniority")?.catalogKey).toBe("custom");
    expect(jobs.warnings).toContain('Made "seniority" a custom column: "seniority" is not a catalog key of the jobs domain');

    const other = normalizeContract({ ...base, domain: "recipes" }, "backend jobs");
    expect(other.contract.domain).toBe("generic");
    expect(other.warnings).toContain('Read the unknown domain "recipes" as generic');
    // Generic records have a name and a link; job keys become custom columns, and no job field is added.
    expect(other.contract.fields.map((f) => [f.name, f.catalogKey])).toEqual([
      ["company_name", "custom"],
      ["title", "title"],
      ["title_2", "custom"],
      ["location", "custom"],
    ]);
    // One record per link, else per name: this contract has no link column.
    expect(other.contract.dedupKeys).toEqual([["title"]]);
  });

  test("a generic request with no searches or pages searches for its own description; a job request leaves that to the boards", () => {
    const podcasts = { ...base, domain: "generic", entityDescription: "A climate tech podcast" };
    expect(normalizeContract(podcasts, "climate podcasts").contract.sourceHints.searchQueries).toEqual(["A climate tech podcast"]);
    expect(normalizeContract({ ...podcasts, domain: "jobs" }, "climate jobs").contract.sourceHints.searchQueries).toEqual([]);
  });

  test("defaults dedup keys and clamps maxRecords", () => {
    const { contract } = normalizeContract({ ...base, maxRecords: 999_999 }, "jobs");
    expect(contract.dedupKeys).toEqual([["url"], ["title", "location"]]);
    expect(contract.maxRecords).toBe(1000);
  });

  test("accepts ordinary regexes but rejects catastrophic-backtracking and overlong ones", () => {
    for (const ok of ["\\b(senior|staff)\\b", "\\$\\d{2,3}k", "remote.*(us|usa)", "(?:foo)+", "^[A-Z]{2}-\\d+$"]) {
      expect(isSafeRegex(ok)).toBe(true);
    }
    for (const evil of ["(a+)+$", "(a*)*b", "([a-z]+)*$", "(\\w+\\s?)*$", "(x{1,10}){1,10}", "(a|a)*$", ".*a.*b", "(unclosed", "a".repeat(201)]) {
      expect(isSafeRegex(evil)).toBe(false);
    }
    const criterion = { id: "r", label: "Evil", kind: "regex" as const, fields: ["title"], values: ["(a+)+$"], strength: "hard" as const, weight: 1 };
    const { contract, warnings } = normalizeContract({ ...base, criteria: [criterion] }, "jobs");
    expect(contract.criteria).toEqual([]);
    expect(warnings).toContain('Dropped criterion "Evil": invalid, too long or too slow regular expression');
  });
});

describe("the compile prompt", () => {
  test("lists every domain, then gives each its catalog and rules after the shared ones", () => {
    for (const pack of PACKS) {
      expect(COMPILE_SYSTEM_PROMPT).toContain(`- "${pack.id}": ${pack.describe}`);
      expect(COMPILE_SYSTEM_PROMPT).toContain(`DOMAIN "${pack.id}": ${pack.describe}\nCatalog keys:\n${bulletList(pack.fields)}`);
      expect(COMPILE_SYSTEM_PROMPT).toContain(pack.prompt);
    }
  });

  test("keeps the rules it had before domains, now in their domain's section", () => {
    for (const rule of [
      "Always include company, title and url.",
      "List 20-35 short title stems and synonyms",
      'for work arrangement use field "remote" with values from "remote", "hybrid", "onsite"',
      "(choose only the 1-3 tags that fit the request; never list all of them)",
      "- ai_lab: Builds frontier AI models",
      "searchQueries: leave empty (RUVO uses its job-board registry).",
      '"custom" for the rest (type "number" for counts and amounts), and require only the fields that identify an item',
    ]) {
      expect(COMPILE_SYSTEM_PROMPT).toContain(rule);
    }
  });
});

describe("compileRequirement", () => {
  beforeEach(resetDb);

  test("sends the prompt to the planner model and normalizes the reply", async () => {
    const fake = fakeResponses({ dataset_contract: { ...DEMO_CONTRACT, fields: DEMO_CONTRACT.fields.filter((f) => f.name !== "url") } });
    const llm = createLlmClient({
      env: { MODEL_PLANNER: "gpt-6-sol", MODEL_WORKER: "gpt-6-luna", LLM_CACHE_MODE: "off", OPENAI_API_KEY: "x" },
      responses: fake.responses,
    });
    const result = await compileRequirement(llm, DEMO_PROMPT);
    expect(fake.calls[0]!.input.at(-1)!.content).toBe(DEMO_PROMPT);
    expect(result.model).toBe("gpt-6-sol");
    expect(result.contract.fields.some((f) => f.name === "url")).toBe(true);
  });
});
