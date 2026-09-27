import { describe, expect, test } from "bun:test";
import { DatasetContract, PlanDraft, RecipeDef } from "@repo/contracts";
import { zodTextFormat } from "openai/helpers/zod";

// These schemas are sent to OpenAI as strict structured outputs; conversion throws on unsupported shapes.
describe("LLM-facing schemas are strict-mode compatible", () => {
  test.each([
    ["DatasetContract", DatasetContract],
    ["PlanDraft", PlanDraft],
    ["RecipeDef", RecipeDef],
  ] as const)("%s", (name, schema) => {
    const format = zodTextFormat(schema, name);
    expect(format.strict).toBe(true);
    expect(JSON.stringify(format.schema)).not.toContain('"additionalProperties":true');
  });
});
