import { describe, expect, test } from "bun:test";
import type { DatasetContract } from "@repo/contracts";
import { discoverSources } from "../src/plan/discovery";
import { DEMO_CONTRACT } from "../src/plan/demoContract";
import type { RegistryCompany } from "../src/plan/registry";

const company = (name: string, ats: RegistryCompany["ats"], slug: string, tags: string[]): RegistryCompany => ({
  id: crypto.randomUUID(),
  name,
  ats,
  slug,
  tags,
  origin: "curated",
  jobCount: 10,
  verifiedAt: null,
});

const registry = [
  company("Anthropic", "greenhouse", "anthropic", ["ai_lab"]),
  company("Modal", "ashby", "modal", ["ai_infra", "devtools"]),
  company("Stripe", "greenhouse", "stripe", ["fintech"]),
];

const contractWith = (hints: Partial<DatasetContract["sourceHints"]>, criteria = DEMO_CONTRACT.criteria): DatasetContract => ({
  ...DEMO_CONTRACT,
  criteria,
  sourceHints: { companies: [], excludeCompanies: [], companyTags: [], urls: [], includeCommunityBoards: false, ...hints },
});

const refs = (contract: DatasetContract) => discoverSources(contract, registry).candidates.map((c) => c.ref);

describe("discoverSources", () => {
  test("named companies take priority; unknown names are reported", () => {
    const result = discoverSources(contractWith({ companies: ["anthropic", "Acme AI"] }), registry);
    expect(result.candidates.map((c) => c.ref)).toEqual(["greenhouse:anthropic"]);
    expect(result.unmatchedCompanies).toEqual(["Acme AI"]);
  });

  test("otherwise selects companies carrying the requested tags", () => {
    expect(refs(contractWith({ companyTags: ["ai_infra"] }, []))).toEqual(["ashby:modal"]);
    // company_tag criteria count as tag hints too
    expect(refs(contractWith({}))).toEqual(["greenhouse:anthropic", "ashby:modal"]);
  });

  test("with no hints at all, offers the whole registry minus exclusions", () => {
    expect(refs(contractWith({ excludeCompanies: ["Stripe"] }, []))).toEqual(["greenhouse:anthropic", "ashby:modal"]);
  });

  test("candidates carry adapter params and a reason", () => {
    const [first] = discoverSources(contractWith({ companyTags: ["ai_lab"] }, []), registry).candidates;
    expect(first).toMatchObject({
      adapter: "greenhouse",
      params: { slug: "anthropic", company: "Anthropic", tags: ["ai_lab"] },
      reason: "Registry tags: ai_lab",
    });
  });

  test("offers the Hacker News board when community boards are requested", () => {
    const refs = discoverSources(contractWith({ includeCommunityBoards: true }, []), registry).candidates.map((c) => c.ref);
    expect(refs).toContain("hn_whoishiring:latest");
    expect(discoverSources(contractWith({}, []), registry).candidates.map((c) => c.ref)).not.toContain("hn_whoishiring:latest");
  });

  test("does not offer sources whose adapter is not implemented yet", () => {
    const result = discoverSources(contractWith({ urls: ["https://example.com/jobs"] }, []), registry);
    expect(result.candidates.some((c) => c.adapter === "html_list")).toBe(false);
  });
});
