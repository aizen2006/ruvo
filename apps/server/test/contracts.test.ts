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

describe("RecipeDef", () => {
  const recipe = (attr: string) => ({ itemSelector: "li.job", fields: [{ name: "url", selector: "a", attr, transform: null }] });

  test("a field reads text or an attribute that holds a link, a date or a label, never e.g. onclick", () => {
    for (const attr of ["text", "href", "src", "datetime", "content", "title", "aria-label"]) expect(RecipeDef.safeParse(recipe(attr)).success).toBe(true);
    for (const attr of ["onclick", "data-url", "style"]) expect(RecipeDef.safeParse(recipe(attr)).success).toBe(false);
  });
});
