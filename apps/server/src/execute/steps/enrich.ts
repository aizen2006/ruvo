import type { FieldSpec } from "@repo/contracts";
import type { FieldValue } from "../../adapters/types";
import { runLadder } from "../../extract/ladder";
import { jsonLdRung } from "../../extract/rungs/jsonLd";
import { llmRung } from "../../extract/rungs/llm";
import { regexRung } from "../../extract/rungs/regex";
import { FetchError } from "../../fetch/errors";
import { LlmError } from "../../llm/client";
import { htmlToText } from "../../libs/text";
import { mapLimit } from "../../libs/limit";
import type { Candidate } from "../candidate";
import { itemKeyFor } from "../contractFields";
import type { StepFn } from "./types";

const CONCURRENCY = 4;

/**
 * Fills fields the source's list data lacks, cheapest first:
 * 1. regex over the description the source already returned (e.g. Greenhouse pay ranges)
 * 2. the posting's own page, when allowed: JSON-LD, then regex over its text (at most `maxFetches` pages)
 * 3. the LLM over the description, only for required fields and only if the plan allows it
 */
export const enrich: StepFn<"enrich"> = async (ctx, branch, step, input) => {
  const fields = ctx.contract.fields.filter((f) => step.fields.includes(f.name));
  const missing = (c: Candidate) => fields.filter((f) => !c.item.fields[itemKeyFor(ctx.contract, f.name)]);
  let fetchesLeft = step.rungs.includes("json_ld") ? step.maxFetches : 0;
  let llmAllowed = step.rungs.includes("llm");
  const counts = { text: 0, page: 0, llm: 0 };

  const enriched = await mapLimit(input, CONCURRENCY, async (candidate) => {
    const filled: Record<string, FieldValue> = {};
    const stillMissing = () => missing(candidate).filter((f) => !filled[f.name]);

    // 1. The description we already have.
    if (candidate.item.text && stillMissing().length) {
      const text = { ...candidate.item.text, text: candidate.item.text.plain };
      const got = await runLadder(ctx, text, stillMissing(), [regexRung]);
      if (Object.keys(got).length) counts.text++;
      Object.assign(filled, got);
    }

    // 2. The posting's own page.
    const url = candidate.item.fields.url?.value;
    if (stillMissing().length && fetchesLeft > 0 && typeof url === "string" && url.startsWith("http")) {
      fetchesLeft--;
      try {
        const page = await ctx.fetcher.fetch(ctx, { url, expect: "html", purpose: "posting page", mode: step.fetch === "browser" ? "browser" : "http" });
        const input = { text: htmlToText(page.body), html: page.body, sourceUrl: page.finalUrl, pageId: page.pageId };
        const got = await runLadder(ctx, input, stillMissing(), [jsonLdRung, regexRung]);
        if (Object.keys(got).length) counts.page++;
        Object.assign(filled, got);
      } catch (err) {
        if (!(err instanceof FetchError)) throw err;
        if (err.kind === "budget_exhausted") fetchesLeft = 0;
      }
    }

    // 3. The LLM, for required fields only.
    const required = stillMissing().filter((f: FieldSpec) => f.required);
    if (required.length && llmAllowed && candidate.item.text) {
      try {
        const text = { ...candidate.item.text, text: candidate.item.text.plain };
        const got = await runLadder(ctx, text, required, [llmRung]);
        if (Object.keys(got).length) counts.llm++;
        Object.assign(filled, got);
      } catch (err) {
        if (!(err instanceof LlmError)) throw err;
        llmAllowed = false;
      }
    }

    if (Object.keys(filled).length === 0) return candidate;
    const mapped = Object.fromEntries(Object.entries(filled).map(([name, value]) => [itemKeyFor(ctx.contract, name), value]));
    return { ...candidate, item: { ...candidate.item, fields: { ...candidate.item.fields, ...mapped } } };
  });

  ctx.emit({
    stage: "extracting",
    type: "enrich.completed",
    sourceId: branch.id,
    message: `${branch.label}: filled ${fields.map((f) => f.name).join(", ")} for ${counts.text} records from descriptions, ${counts.page} from posting pages${counts.llm ? `, ${counts.llm} with the LLM` : ""}`,
    data: counts,
  });
  return enriched;
};
