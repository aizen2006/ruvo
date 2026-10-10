import { beforeEach, describe, expect, test } from "bun:test";
import type { DatasetContract } from "@repo/contracts";
import { createBudget, createMetrics, type RunContext } from "../src/core/run";
import { documentsPack } from "../src/domains/documents";
import { documentHits } from "../src/domains/documents/adapter";
import { FetchError } from "../src/fetch/errors";
import type { Fetcher, HeadResult } from "../src/fetch/fetcher";
import { getPage } from "../src/fetch/pageCache";
import { DEMO_CONTRACT } from "../src/plan/demoContract";
import { discoverSources } from "../src/plan/discovery";
import { compileIr } from "../src/plan/irCompiler";
import { templateDraft } from "../src/plan/templates";
import { resetDb } from "./helpers/db";

const DOCS: DatasetContract = {
  ...DEMO_CONTRACT,
  domain: "documents",
  title: "Voice model API documentation",
  entityDescription: "A PDF document on using voice model APIs",
  fields: [
    { name: "title", catalogKey: "title", type: "string", required: true, description: "Document title" },
    { name: "url", catalogKey: "url", type: "url", required: true, description: "Link to the file" },
    { name: "site", catalogKey: "site", type: "string", required: false, description: "Website" },
    { name: "published", catalogKey: "published", type: "date", required: false, description: "Published" },
    { name: "file_type", catalogKey: "file_type", type: "string", required: false, description: "Format" },
    { name: "size_bytes", catalogKey: "size_bytes", type: "number", required: false, description: "Size" },
    { name: "summary", catalogKey: "summary", type: "string", required: false, description: "What it covers" },
  ],
  criteria: [],
  assumptions: [],
  dedupKeys: [["url"]],
};

const hit = (url: string, query: string, title = "A guide", description = "") => ({ url, title, description, query });

describe("the documents pack's search", () => {
  const search = documentsPack.search!;

  test("searches each query again for PDF files, unless it names a file type already", () => {
    expect(search.queries(DOCS, ["voice api docs", "tts guide filetype:pdf"], 1)).toEqual(["voice api docs filetype:pdf"]);
  });

  test("claims PDF hits, and makes each search's files one source whichever of its two searches found them", async () => {
    expect(search.recognize(hit("https://a.example/guide.pdf", "q"))).toBe(true);
    expect(search.recognize(hit("https://a.example/guide", "q"))).toBe(false);

    const hits = [
      hit("https://a.example/one.pdf", "voice api docs filetype:pdf"),
      hit("https://b.example/two.pdf", "voice api docs filetype:pdf"),
      hit("https://a.example/page", "voice api docs"),
      hit("https://a.example/one.pdf", "voice api docs"),
      hit("https://c.example/three.pdf", "tts guide"),
      hit("https://d.example/four.pdf", "speech sdk filetype:pdf"),
    ];
    const sources = await search.sources(DOCS, hits, { seen: new Set(["document_hits:tts guide"]), max: 5, userAgent: "test" });
    expect(sources.map((s) => [s.ref, s.adapter, (s.params as { hits: Array<{ url: string }> }).hits.map((h) => h.url)])).toEqual([
      ["document_hits:voice api docs", "document_hits", ["https://a.example/one.pdf", "https://b.example/two.pdf"]],
      ["document_hits:speech sdk", "document_hits", ["https://d.example/four.pdf"]],
    ]);
    expect(sources[0]!.label).toBe('PDF files for "voice api docs"');
    expect(sources[0]!.reason).toContain("the files are never downloaded");
    expect(search.summarize(sources)).toBe("3 PDF files from 2 searches");
    expect(await search.sources(DOCS, hits, { seen: new Set(), max: 1, userAgent: "test" })).toHaveLength(1);
  });
});

describe("document leads", () => {
  beforeEach(resetDb);

  const GUIDE = {
    url: "https://docs.example/voice/guide.pdf",
    title: "[PDF] Voice API Developer Guide",
    description: "How to stream speech to text with the Voice API. 42 pages.",
    query: "voice api docs filetype:pdf",
    publishedDate: "2025-03-04T00:00:00",
  };
  const PRICING = { url: "https://b.example/pricing.pdf", title: "Voice API pricing", description: "", query: "voice api docs" };
  type Hit = { url: string; title: string; description: string; query: string; publishedDate?: string };

  /** A fetcher that answers HEAD with `head` and fails anything that would download a file. */
  const fetcherWith = (head: Fetcher["head"]): Fetcher => ({
    fetch: () => Promise.reject(new Error("downloaded a file")),
    json: () => Promise.reject(new Error("downloaded a file")),
    head,
  });
  const noService = fetcherWith(async () => null);
  const pdfHead = (url: string, more: Partial<HeadResult> = {}): HeadResult => ({
    finalUrl: url,
    status: 200,
    contentType: "application/pdf",
    contentLength: 52_000,
    filename: null,
    lastModified: "Wed, 05 Mar 2025 10:00:00 GMT",
    ...more,
  });

  const run = (contract = DOCS) =>
    ({
      runId: crypto.randomUUID(),
      signal: new AbortController().signal,
      contract,
      budget: createBudget({ maxPages: 10, maxBrowserPages: 0, maxLlmCalls: 0, maxDurationMs: 60_000, maxRecords: 10 }),
      metrics: createMetrics(),
      emit: () => {},
    }) as unknown as RunContext;
  const collect = (fetcher: Fetcher, hits: Hit[], ctx = run()) => documentHits.collect({ fetcher, scope: ctx, run: ctx }, { hits });
  const values = (fields: Record<string, { value: unknown } | undefined>) => Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v!.value]));

  test("reads a file's title, link, site, date, type and summary from its search result, with SEARCH evidence", async () => {
    const [item] = await collect(noService, [GUIDE]);
    expect(values(item!.fields)).toEqual({
      title: "Voice API Developer Guide",
      url: GUIDE.url,
      site: "docs.example",
      published: "2025-03-04",
      file_type: "PDF",
      summary: GUIDE.description,
    });
    for (const value of Object.values(item!.fields)) expect(value!.evidence).toMatchObject({ method: "SEARCH", sourceUrl: GUIDE.url, verified: true });
    expect(item!.fields.published!.evidence.snippet).toBe("2025-03-04T00:00:00");
    // The search result is the receipt; the file itself is never fetched.
    expect(await getPage(item!.fields.title!.evidence.pageId!)).toMatchObject({ via: "search", url: GUIDE.url });
  });

  test("a file's headers add its type, size and, when search gave none, its date and title, as DOC_META", async () => {
    const pasted = { url: "https://c.example/files/voice-sdk.pdf", title: "", description: "", query: "" };
    const heads: Record<string, HeadResult> = {
      [GUIDE.url]: pdfHead(GUIDE.url),
      [pasted.url]: pdfHead(pasted.url, { contentType: "application/octet-stream", filename: "Voice SDK Manual.pdf" }),
    };
    const [guide, file] = await collect(fetcherWith(async (_scope, url) => heads[url]!), [GUIDE, pasted]);

    // Search's date stays; the headers' type outranks the link's.
    expect(values(guide!.fields)).toMatchObject({ published: "2025-03-04", file_type: "PDF", size_bytes: "52000" });
    expect(guide!.fields.published!.evidence.method).toBe("SEARCH");
    expect(guide!.fields.file_type!.evidence).toMatchObject({ method: "DOC_META", locator: { kind: "docMeta", value: "Content-Type" }, pageId: null, verified: true });
    expect(values(file!.fields)).toMatchObject({ title: "Voice SDK Manual", published: "2025-03-05", file_type: "PDF", size_bytes: "52000" });
    expect(file!.fields.published!.evidence).toMatchObject({ method: "DOC_META", locator: { kind: "docMeta", value: "Last-Modified" } });
    expect(file!.fields.file_type!.evidence.locator).toEqual({ kind: "docMeta", value: "URL" });
  });

  test("a page at a file's address is dropped; a refused request keeps the lead as search found it", async () => {
    const fetcher = fetcherWith(async (_scope, url) => {
      if (url === GUIDE.url) return pdfHead(url, { contentType: "text/html; charset=utf-8" });
      throw new FetchError("robots_disallowed", "robots.txt disallows it", { url });
    });
    const items = await collect(fetcher, [GUIDE, PRICING]);
    expect(items.map((i) => i.fields.url!.value)).toEqual([PRICING.url]);
    expect(Object.values(items[0]!.fields).every((v) => v!.evidence.method === "SEARCH")).toBe(true);
  });

  test("asks only about the files triage keeps, three at a time", async () => {
    const noPricing = { id: "no_pricing", label: "Not pricing", kind: "keyword_none" as const, fields: ["title"], values: ["pricing"], strength: "hard" as const, weight: 1 };
    const files = Array.from({ length: 7 }, (_, i) => ({ ...GUIDE, url: `https://docs.example/${i}.pdf` }));
    const asked: string[] = [];
    let inFlight = 0;
    let most = 0;
    const fetcher = fetcherWith(async (_scope, url) => {
      asked.push(url);
      most = Math.max(most, ++inFlight);
      await Bun.sleep(5);
      inFlight--;
      return pdfHead(url);
    });
    const items = await collect(fetcher, [...files, PRICING], run({ ...DOCS, criteria: [noPricing] }));
    expect(items).toHaveLength(8);
    expect(asked).toHaveLength(7);
    expect(asked).not.toContain(PRICING.url);
    expect(most).toBe(3);
  });
});

describe("planning documents", () => {
  const caps = { maxPages: 10, maxBrowserPages: 0, maxLlmCalls: 10, maxDurationMs: 60_000, maxRecords: 10 };
  const provenance = { plannedBy: "template" as const, model: null, reusedFrom: null, parentVersion: null };

  test("a linked PDF is a document source of its own, never read as a page", async () => {
    const urls = ["https://a.example/files/guide.pdf", "https://a.example/docs"];
    const candidates = await discoverSources({ ...DOCS, sourceHints: { ...DOCS.sourceHints, urls } });
    expect(candidates.map((c) => [c.ref, c.adapter, c.origin])).toEqual([
      ["document_hits:https://a.example/files/guide.pdf", "document_hits", "user_url"],
      ["html_list:https://a.example/docs", "html_list", "user_url"],
    ]);
    expect(candidates[0]!.params).toEqual({ hits: [{ url: urls[0], title: "", description: "", query: "" }] });
  });

  test("a documents request's IR reads its files from their search results: no enrich step, title and link stay required", async () => {
    const [found] = await documentsPack.search!.sources(DOCS, [hit("https://a.example/guide.pdf", "voice api docs filetype:pdf")], { seen: new Set(), max: 5, userAgent: "test" });
    const candidate = { ...found!, params: found!.params as Record<string, unknown>, tags: [], jobCount: null, origin: "search" as const };
    const ir = compileIr(DOCS, templateDraft([candidate], 20), [candidate], { caps, provenance });
    expect(ir.domain).toBe("documents");
    const steps = ir.sources[0]!.steps;
    expect(steps.map((s) => s.kind)).toEqual(["collect", "prefilter", "match", "validate", "store"]);
    expect(steps[0]).toMatchObject({ adapter: "document_hits", fetch: "http" });
    expect(steps.find((s) => s.kind === "validate")).toMatchObject({ required: ["title", "url"] });
    expect(ir.provenance.warnings).toEqual([]);
  });
});
