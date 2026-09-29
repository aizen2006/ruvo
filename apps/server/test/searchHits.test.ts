import { beforeEach, describe, expect, test } from "bun:test";
import type { DatasetContract } from "@repo/contracts";
import { searchHits } from "../src/adapters/searchHits";
import type { Fetcher } from "../src/fetch/fetcher";
import { getPage } from "../src/fetch/pageCache";
import { DEMO_CONTRACT } from "../src/plan/demoContract";
import { createBudget } from "../src/runs/budget";
import { createMetrics } from "../src/runs/metrics";
import type { RunContext } from "../src/runs/runContext";
import { resetDb } from "./helpers/db";
import { fakeLlm } from "./helpers/fakeLlm";

beforeEach(resetDb);

const CREATORS: DatasetContract = {
  ...DEMO_CONTRACT,
  entity: "other",
  entityDescription: "A climate content creator on Instagram",
  fields: [
    { name: "name", catalogKey: "title", type: "string", required: true, description: "Creator name" },
    { name: "profile_url", catalogKey: "url", type: "url", required: true, description: "Profile link" },
    { name: "handle", catalogKey: "custom", type: "string", required: false, description: "Instagram handle" },
    { name: "followers", catalogKey: "custom", type: "number", required: false, description: "Follower count" },
    { name: "bio", catalogKey: "custom", type: "string", required: false, description: "Their bio" },
    { name: "niche", catalogKey: "custom", type: "string", required: false, description: "Topic they cover" },
  ],
  criteria: [],
  dedupKeys: [["profile_url"]],
};

const HIT = {
  url: "https://instagram.com/climatepod",
  title: "Climate Pod (@climatepod) • Instagram",
  description: "24K followers · 310 posts · Weekly interviews on climate tech and clean energy",
  query: "climate creators site:instagram.com",
};

/** Any fetch fails the test: search results must never lead to fetching the profile. */
const noFetch: Fetcher = {
  fetch: () => Promise.reject(new Error("fetched a page")),
  json: () => Promise.reject(new Error("fetched a page")),
};

function run(llm: ReturnType<typeof fakeLlm>) {
  return {
    runId: crypto.randomUUID(),
    signal: new AbortController().signal,
    contract: CREATORS,
    budget: createBudget({ maxPages: 0, maxBrowserPages: 0, maxLlmCalls: 5, maxDurationMs: 60_000, maxRecords: 10 }),
    metrics: createMetrics(),
    llm,
    emit: () => {},
  } as unknown as RunContext;
}

describe("search_hits adapter", () => {
  test("reads name, handle, follower count and bio from the search result, with SEARCH evidence", async () => {
    const llm = fakeLlm({ field_extraction: { fields: [{ name: "niche", value: "climate tech", quote: "climate tech" }] } });
    const ctx = run(llm);
    const [item] = await searchHits.collect({ fetcher: noFetch, scope: ctx, run: ctx }, { site: "instagram.com", hits: [HIT] });

    const values = Object.fromEntries(Object.entries(item!.fields).map(([k, v]) => [k, v!.value]));
    expect(values).toEqual({
      title: "Climate Pod",
      url: HIT.url,
      handle: "@climatepod",
      followers: "24000",
      bio: "Weekly interviews on climate tech and clean energy",
      niche: "climate tech",
    });
    for (const value of Object.values(item!.fields)) {
      expect(value!.evidence).toMatchObject({ method: "SEARCH", sourceUrl: HIT.url, verified: true });
    }
    expect(item!.fields.followers!.evidence.snippet).toBe("24K followers");

    // Only the column no pattern answers went to the model; the snippet is kept as a "search" page.
    expect(JSON.parse(llm.calls[0]!.input.at(-1)!.content).fields.map((f: { name: string }) => f.name)).toEqual(["niche"]);
    const page = await getPage(item!.fields.handle!.evidence.pageId!);
    expect(page).toMatchObject({ via: "search", url: HIT.url, body: `${HIT.title}\n${HIT.description}` });
  });

  test("a model value whose quote is not in the snippet is dropped", async () => {
    const ctx = run(fakeLlm({ field_extraction: { fields: [{ name: "niche", value: "fashion", quote: "fashion and beauty" }] } }));
    const [item] = await searchHits.collect({ fetcher: noFetch, scope: ctx, run: ctx }, { site: "instagram.com", hits: [HIT] });
    expect(item!.fields.niche).toBeUndefined();
  });
});
