import { beforeEach, describe, expect, test } from "bun:test";
import type { FieldSpec } from "@repo/contracts";
import { hnWhoIsHiring } from "../src/adapters/hn";
import { toCandidate } from "../src/execute/candidate";
import { extractText } from "../src/execute/steps/extractText";
import { runLadder } from "../src/extract/ladder";
import { llmRung, quoteSupports } from "../src/extract/rungs/llm";
import { regexRung } from "../src/extract/rungs/regex";
import { verifyQuote } from "../src/extract/verifyQuote";
import { DEMO_CONTRACT } from "../src/plan/demoContract";
import { createBudget } from "../src/runs/budget";
import { createMetrics } from "../src/runs/metrics";
import type { RunContext } from "../src/runs/runContext";
import { resetDb } from "./helpers/db";
import { fakeLlm } from "./helpers/fakeLlm";
import { fixtureFetcher, loadFixture, testScope } from "./helpers/fixtures";

beforeEach(resetDb);

describe("verifyQuote", () => {
  const text = "We’re hiring a Senior  Backend Engineer\n(remote – EU). Pay: $150k–$190k.";

  test("maps a normalized match back to the original span", () => {
    const span = verifyQuote("we're hiring a senior backend engineer", text)!;
    expect(text.slice(span.start, span.end)).toBe("We’re hiring a Senior  Backend Engineer");
  });

  test("tolerates dash and whitespace variants", () => {
    const span = verifyQuote("(remote - EU)", text)!;
    expect(text.slice(span.start, span.end)).toBe("(remote – EU)");
  });

  test("rejects quotes that are not in the text", () => {
    expect(verifyQuote("fully remote worldwide", text)).toBeNull();
    expect(verifyQuote("a", text)).toBeNull();
  });
});

function fakeContext(llm: ReturnType<typeof fakeLlm>, maxLlmCalls = 10) {
  const events: Array<{ type: string; message: string }> = [];
  const ctx = {
    runId: crypto.randomUUID(),
    signal: new AbortController().signal,
    contract: DEMO_CONTRACT,
    budget: createBudget({ maxPages: 10, maxBrowserPages: 0, maxLlmCalls, maxDurationMs: 60_000, maxRecords: 10 }),
    metrics: createMetrics(),
    llm,
    emit: (e: { type: string; message: string }) => events.push(e),
  } as unknown as RunContext;
  return { ctx, events };
}

const fields = (names: string[]) => DEMO_CONTRACT.fields.filter((f) => names.includes(f.name)) as FieldSpec[];
const input = { text: "Acme AI is hiring a Backend Engineer in Berlin. Salary €80k–€95k.", sourceUrl: "https://news.ycombinator.com/item?id=1", pageId: null };

describe("extraction ladder", () => {
  test("regex fills salary without calling the LLM", async () => {
    const llm = fakeLlm();
    const { ctx } = fakeContext(llm);
    const out = await runLadder(ctx, input, fields(["salary"]), [regexRung, llmRung]);
    expect(out.salary?.value).toBe("EUR 80,000–95,000 / year");
    expect(out.salary?.evidence.method).toBe("REGEX");
    expect(llm.calls).toHaveLength(0);
  });

  test("the LLM rung keeps verified values and drops invented ones", async () => {
    const llm = fakeLlm({
      field_extraction: {
        fields: [
          { name: "title", value: "Backend Engineer", quote: "hiring a Backend Engineer" },
          { name: "location", value: "Berlin", quote: "in Berlin" },
          { name: "company", value: "Acme Corp", quote: "Acme Corp is hiring" },
        ],
      },
    });
    const { ctx, events } = fakeContext(llm);
    const out = await runLadder(ctx, input, fields(["title", "location", "company"]), [regexRung, llmRung]);

    expect(out.title).toMatchObject({ value: "Backend Engineer", evidence: { method: "LLM", verified: true, snippet: "hiring a Backend Engineer" } });
    expect(out.location?.value).toBe("Berlin");
    expect(out.company).toBeUndefined();
    expect(events.some((e) => e.type === "extract.unverified")).toBe(true);
    expect(ctx.metrics.snapshot().llmCalls).toBe(1);
  });
});

describe("extract_text step", () => {
  test("fills unparsed HN posts from their text within the LLM allowance", async () => {
    const threadId = String(loadFixture<{ id: number }>("hn-thread").data.id);
    const { fetcher } = fixtureFetcher({ "hn.algolia.com": "hn-thread" });
    const items = await hnWhoIsHiring.collect({ fetcher, scope: testScope() }, { thread: threadId });
    const candidates = items.map((i) => toCandidate("src_hn", i));
    const unparsed = candidates.filter((c) => !c.item.meta.parsedHeader);

    // The fake model "finds" a title by quoting the post's first words.
    const llm = fakeLlm({
      field_extraction: ({ input }: { input: Array<{ content: string }> }) => {
        const { text } = JSON.parse(input.at(-1)!.content) as { text: string };
        const quote = text.slice(0, 20);
        return { fields: [{ name: "title", value: quote, quote }] };
      },
    });
    const { ctx, events } = fakeContext(llm);
    const step = { id: "x", kind: "extract_text" as const, parser: "hn_header" as const, llmFallback: true, llmBudget: 2 };
    const out = await extractText(ctx, { id: "src_hn", label: "HN" } as never, step, candidates);

    // Only posts missing a required field are eligible, and only 2 are allowed.
    expect(llm.calls).toHaveLength(2);
    const newlyTitled = out.filter((c, i) => !candidates[i]!.item.fields.title && c.item.fields.title);
    expect(newlyTitled).toHaveLength(2);
    expect(unparsed.length).toBeGreaterThan(2);
    expect(events.at(-1)?.type).toBe("extract.completed");
  });
});

describe("quoteSupports", () => {
  const field = (catalogKey: FieldSpec["catalogKey"]) => ({ name: catalogKey, catalogKey, type: "string", required: false, description: "" }) as FieldSpec;

  test.each([
    ["salary", "$250,000 - $300,000", "The base salary range is $250,000–$300,000 per year.", true],
    ["salary", "$250,000", "We offer a competitive salary.", false],
    ["remote", "remote", "This role is fully remote within the US.", true],
    ["remote", "remote", "You will work from our Berlin office.", false],
    ["location", "Berlin, Germany", "Based in Berlin, Germany or remote.", true],
    ["location", "Paris", "Based in Berlin, Germany.", false],
  ] as const)("%s %p in %p → %p", (key, value, quote, supported) => {
    expect(quoteSupports(field(key), value, quote)).toBe(supported);
  });
});
