import { describe, expect, test } from "bun:test";
import { hnPermalink, hnWhoIsHiring } from "../src/adapters/hn";
import { fixtureFetcher, loadFixture, testScope } from "./helpers/fixtures";

const threadId = String(loadFixture<{ id: number }>("hn-thread").data.id);

async function collect() {
  const { fetcher, requested } = fixtureFetcher({ "hn.algolia.com/api/v1/items": "hn-thread" });
  const items = await hnWhoIsHiring.collect({ fetcher, scope: testScope() }, { thread: threadId });
  return { items, requested };
}

describe("hn_whoishiring adapter", () => {
  test("turns every top-level comment into an item with its text and permalink", async () => {
    const { items, requested } = await collect();
    expect(requested).toEqual([`https://hn.algolia.com/api/v1/items/${threadId}`]);
    expect(items).toHaveLength(40);
    expect(items.every((i) => i.text?.sourceUrl === hnPermalink(i.externalId))).toBe(true);
    expect(items.every((i) => !i.text?.plain.includes("<p>"))).toBe(true);
  });

  test("parses structured headers into fields with verified text-span evidence", async () => {
    const { items } = await collect();
    const modash = items.find((i) => i.fields.company?.value === "Modash.io")!;
    expect(modash.fields.title?.value).toBe("Senior Product Engineer");
    expect(modash.fields.remote?.value).toBe("remote");
    expect(modash.fields.salary?.value).toBe("EUR 75,000–110,000 / year");

    const evidence = modash.fields.salary!.evidence;
    expect(evidence).toMatchObject({ method: "REGEX", verified: true, locator: { kind: "textSpan" } });
    const [start, end] = evidence.locator.value.split("-").map(Number);
    expect(modash.text!.plain.slice(start, end)).toBe(evidence.snippet);
  });

  test("leaves prose posts without fields for the LLM rung", async () => {
    const { items } = await collect();
    const parsed = items.filter((i) => i.meta.parsedHeader);
    expect(parsed.length).toBeGreaterThan(20);
    expect(items.filter((i) => !i.meta.parsedHeader).every((i) => Object.keys(i.fields).length === 0)).toBe(true);
  });

  test("falls back to the post permalink when the header has no link", async () => {
    const { items } = await collect();
    const noLink = items.find((i) => i.meta.parsedHeader && i.fields.url?.evidence.method === "DERIVED")!;
    expect(noLink.fields.url?.value).toBe(hnPermalink(noLink.externalId));
  });
});
