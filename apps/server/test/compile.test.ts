import { beforeEach, describe, expect, test } from "bun:test";
import type { DatasetContract } from "@repo/contracts";
import { normalizeContract } from "../src/compile/normalize";
import { compileRequirement } from "../src/compile/requirementCompiler";
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
          { id: "arr", label: "Remote", kind: "equals", fields: ["remote"], values: ["remote"], strength: "soft", weight: 5 },
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

  test('injects the "good companies" interpretation when the model left it out', () => {
    const { contract } = normalizeContract(base, "Backend roles at good technology companies");
    expect(contract.criteria.find((c) => c.kind === "company_tag")?.strength).toBe("soft");
    expect(contract.assumptions[0]?.phrase).toBe("good companies");
  });

  test("defaults dedup keys and clamps maxRecords", () => {
    const { contract } = normalizeContract({ ...base, maxRecords: 999_999 }, "jobs");
    expect(contract.dedupKeys).toEqual([["url"], ["title", "location"]]);
    expect(contract.maxRecords).toBe(1000);
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
