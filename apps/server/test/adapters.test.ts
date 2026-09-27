import { describe, expect, test } from "bun:test";
import { ashby } from "../src/adapters/ashby";
import { greenhouse } from "../src/adapters/greenhouse";
import { lever } from "../src/adapters/lever";
import type { AtsParams } from "../src/adapters/ats";
import type { Item, SourceAdapter } from "../src/adapters/types";
import { workable } from "../src/adapters/workable";
import { fixtureFetcher, testScope } from "./helpers/fixtures";

type Case = { adapter: SourceAdapter<AtsParams>; fixture: string; slug: string; company: string };

const cases: Case[] = [
  { adapter: greenhouse, fixture: "greenhouse", slug: "anthropic", company: "Anthropic" },
  { adapter: ashby, fixture: "ashby", slug: "openai", company: "OpenAI" },
  { adapter: lever, fixture: "lever", slug: "palantir", company: "Palantir" },
  { adapter: workable, fixture: "workable", slug: "huggingface", company: "Hugging Face" },
];

async function collect({ adapter, fixture, slug, company }: Case) {
  const { fetcher, requested } = fixtureFetcher(fixture);
  const items = await adapter.collect({ fetcher, scope: testScope() }, { slug, company, tags: ["ai_lab"] });
  return { items, requested };
}

const value = (item: Item, field: string) => item.fields[field]?.value;

describe.each(cases)("$fixture adapter", (c) => {
  test("requests the board for the given slug", async () => {
    const { requested } = await collect(c);
    expect(requested).toHaveLength(1);
    expect(requested[0]).toContain(c.slug);
  });

  test("every item has a title, company and URL", async () => {
    const { items } = await collect(c);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(typeof value(item, "title")).toBe("string");
      expect(typeof value(item, "company")).toBe("string");
      expect(String(value(item, "url"))).toMatch(/^https:\/\//);
    }
  });

  test("every field carries evidence pointing at the public job URL", async () => {
    const { items } = await collect(c);
    for (const item of items) {
      for (const field of Object.values(item.fields)) {
        expect(field!.evidence.sourceUrl).toBe(String(value(item, "url")));
        expect(field!.evidence.snippet.length).toBeGreaterThan(0);
        expect(field!.evidence.verified).toBe(true);
        if (field!.evidence.method === "API") expect(field!.evidence.locator.kind).toBe("jsonPath");
      }
    }
  });

  test("carries registry tags onto every item", async () => {
    const { items } = await collect(c);
    expect(items.every((i) => (i.meta.companyTags as string[]).includes("ai_lab"))).toBe(true);
  });

  test("only produces fields it declares in `provides`", async () => {
    const { items } = await collect(c);
    for (const item of items) {
      for (const name of Object.keys(item.fields)) expect(c.adapter.provides).toHaveProperty(name);
    }
  });
});

describe("adapter specifics", () => {
  test("greenhouse reads the Location Type metadata and cleans repeated locations", async () => {
    const [first] = (await collect(cases[0]!)).items;
    expect(value(first!, "remote")).toBe("onsite");
    expect(first!.fields.remote!.evidence.snippet).toBe("On-Site");
    expect(value(first!, "location")).toBe("New York City, NY; San Francisco, CA");
    expect(first!.text?.plain).toContain("About Anthropic");
    expect(first!.text?.plain).not.toContain("&lt;");
  });

  test("ashby maps structured compensation to a salary", async () => {
    const [first] = (await collect(cases[1]!)).items;
    expect(value(first!, "salary")).toBe("USD 257,000–335,000 / year");
    expect(first!.fields.salary!.evidence.locator.value).toBe("$.jobs[0].compensation.summaryComponents[0]");
    expect(value(first!, "employment_type")).toBe("Full-time");
  });

  test("lever uses workplaceType and converts createdAt to ISO", async () => {
    const [first] = (await collect(cases[2]!)).items;
    expect(value(first!, "remote")).toBe("hybrid");
    expect(String(value(first!, "posted_at"))).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(first!.fields.company!.evidence.method).toBe("DERIVED");
  });

  test("workable marks telecommuting roles remote", async () => {
    const [first] = (await collect(cases[3]!)).items;
    expect(value(first!, "remote")).toBe("remote");
    expect(value(first!, "company")).toBe("Hugging Face");
  });
});
