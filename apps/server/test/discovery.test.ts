import { beforeEach, describe, expect, test } from "bun:test";
import type { DatasetContract } from "@repo/contracts";
import { db } from "../src/db/client";
import { registryCompanies } from "../src/db/schema";
import type { RegistryCompany } from "../src/domains/jobs/registry";
import { registrySources } from "../src/domains/jobs/sources";
import { DEMO_CONTRACT } from "../src/plan/demoContract";
import { discoverSources } from "../src/plan/discovery";
import { resetDb } from "./helpers/db";

const company = (name: string, ats: RegistryCompany["ats"], slug: string, tags: string[]): RegistryCompany => ({
  id: crypto.randomUUID(),
  name,
  ats,
  slug,
  tags,
  boardUrl: null, origin: "curated",
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
  sourceHints: { companies: [], excludeCompanies: [], companyTags: [], urls: [], searchQueries: [], includeCommunityBoards: false, ...hints },
});

const refs = (contract: DatasetContract) => registrySources(contract, registry).candidates.map((c) => c.ref);

describe("registrySources", () => {
  test("named companies take priority; unknown names are reported", () => {
    const result = registrySources(contractWith({ companies: ["anthropic", "Acme AI"] }), registry);
    expect(result.candidates.map((c) => c.ref)).toEqual(["greenhouse:anthropic"]);
    expect(result.unmatched).toEqual(["Acme AI"]);
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
    const [first] = registrySources(contractWith({ companyTags: ["ai_lab"] }, []), registry).candidates;
    expect(first).toMatchObject({
      adapter: "greenhouse",
      params: { slug: "anthropic", company: "Anthropic", tags: ["ai_lab"] },
      reason: "Registry tags: ai_lab",
    });
  });

  test("registry companies with a board page are collected from it", () => {
    const withBoard = [{ ...registry[0]!, boardUrl: "https://apply.workable.com/acme/" }];
    const [candidate] = registrySources(contractWith({ companyTags: ["ai_lab"] }, []), withBoard).candidates;
    expect(candidate).toMatchObject({ adapter: "html_list", params: { url: "https://apply.workable.com/acme/", company: "Anthropic" } });
  });
});

describe("discoverSources for a job request", () => {
  beforeEach(async () => {
    await resetDb();
    await db.insert(registryCompanies).values(registry.map(({ id: _id, ...c }) => c));
  });

  test("offers the Hacker News board when community boards are requested", async () => {
    expect((await discoverSources(contractWith({ includeCommunityBoards: true }, []))).map((c) => c.ref)).toContain("hn_whoishiring:latest");
    expect((await discoverSources(contractWith({}, []))).map((c) => c.ref)).not.toContain("hn_whoishiring:latest");
  });

  test("user-supplied URLs come first as list-page sources, and are the only ones unless companies are named", async () => {
    const linked = await discoverSources(contractWith({ urls: ["https://example.com/jobs"], companyTags: ["ai_lab"] }, []));
    expect(linked).toHaveLength(1);
    expect(linked[0]).toMatchObject({ label: "example.com", params: { url: "https://example.com/jobs" }, origin: "user_url" });

    const named = await discoverSources(contractWith({ urls: ["https://example.com/jobs"], companies: ["Anthropic"] }, []));
    expect(named.map((c) => c.origin)).toEqual(["user_url", "registry"]);
  });
});
