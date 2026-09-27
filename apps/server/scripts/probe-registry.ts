/**
 * Verifies the curated company candidates against the live ATS APIs and writes the
 * ones with a working board to src/plan/data/companies.json: `bun run probe:registry`.
 * A candidate whose preferred ATS fails is also tried on the other ATSs.
 */
import { writeFile } from "node:fs/promises";
import type { Ats } from "../src/adapters/ats";
import { env } from "../src/config/env";
import { findBoard } from "../src/plan/atsProbe";
import type { COMPANY_TAGS, CuratedCompany } from "../src/plan/registry";

type Candidate = { name: string; ats: Ats; slug: string; tags: Array<(typeof COMPANY_TAGS)[number]> };

// Hand-picked AI, infrastructure and developer-tool companies. Slugs are guesses until probed.
const CANDIDATES: Candidate[] = [
  { name: "Anthropic", ats: "greenhouse", slug: "anthropic", tags: ["ai_lab"] },
  { name: "OpenAI", ats: "ashby", slug: "openai", tags: ["ai_lab"] },
  { name: "Hugging Face", ats: "workable", slug: "huggingface", tags: ["ai_lab", "open_source"] },
  { name: "Cohere", ats: "ashby", slug: "cohere", tags: ["ai_lab"] },
  { name: "Perplexity", ats: "ashby", slug: "perplexity", tags: ["ai_lab"] },
  { name: "Mistral AI", ats: "lever", slug: "mistral", tags: ["ai_lab", "open_source"] },
  { name: "ElevenLabs", ats: "ashby", slug: "elevenlabs", tags: ["ai_lab"] },
  { name: "Databricks", ats: "greenhouse", slug: "databricks", tags: ["data_platform", "ai_infra"] },
  { name: "Scale AI", ats: "greenhouse", slug: "scaleai", tags: ["ai_infra"] },
  { name: "Together AI", ats: "greenhouse", slug: "togetherai", tags: ["ai_infra"] },
  { name: "Modal", ats: "ashby", slug: "modal", tags: ["ai_infra", "devtools"] },
  { name: "Baseten", ats: "ashby", slug: "baseten", tags: ["ai_infra"] },
  { name: "Pinecone", ats: "ashby", slug: "pinecone", tags: ["ai_infra", "data_platform"] },
  { name: "LangChain", ats: "ashby", slug: "langchain", tags: ["ai_infra", "devtools", "open_source"] },
  { name: "Replicate", ats: "ashby", slug: "replicate", tags: ["ai_infra", "devtools"] },
  { name: "Anysphere (Cursor)", ats: "ashby", slug: "anysphere", tags: ["ai_lab", "devtools"] },
  { name: "Vercel", ats: "greenhouse", slug: "vercel", tags: ["devtools"] },
  { name: "Supabase", ats: "ashby", slug: "supabase", tags: ["devtools", "data_platform", "open_source"] },
  { name: "Cloudflare", ats: "greenhouse", slug: "cloudflare", tags: ["devtools"] },
  { name: "Datadog", ats: "greenhouse", slug: "datadog", tags: ["devtools", "data_platform"] },
  { name: "Stripe", ats: "greenhouse", slug: "stripe", tags: ["fintech", "devtools"] },
  { name: "Palantir", ats: "lever", slug: "palantir", tags: ["data_platform"] },
  { name: "Spotify", ats: "lever", slug: "spotify", tags: ["consumer_tech"] },
];

const verified: CuratedCompany[] = [];
for (const candidate of CANDIDATES) {
  const hit = await findBoard(candidate.slug, { userAgent: env.USER_AGENT, prefer: candidate.ats });
  if (!hit) {
    console.log(`MISS  ${candidate.name.padEnd(20)} no board for "${candidate.slug}"`);
    continue;
  }
  const moved = hit.ats !== candidate.ats ? ` (found on ${hit.ats}, not ${candidate.ats})` : "";
  console.log(`OK    ${candidate.name.padEnd(20)} ${hit.ats}/${hit.slug}: ${hit.jobCount} postings${moved}`);
  verified.push({ ...candidate, ats: hit.ats, jobCount: hit.jobCount, verifiedAt: new Date().toISOString() });
}

const out = new URL("../src/plan/data/companies.json", import.meta.url);
await writeFile(out, `${JSON.stringify(verified, null, 2)}\n`);
console.log(`\n${verified.length}/${CANDIDATES.length} verified → src/plan/data/companies.json`);
