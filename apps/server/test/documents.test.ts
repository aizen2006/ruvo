import { describe, expect, test } from "bun:test";
import type { DatasetContract } from "@repo/contracts";
import { documentsPack } from "../src/domains/documents";
import { DEMO_CONTRACT } from "../src/plan/demoContract";

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
