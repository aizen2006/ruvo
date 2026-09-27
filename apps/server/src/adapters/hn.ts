import { z } from "zod";
import { parseHnHeader } from "../extract/parsers/hnHeader";
import { formatSalary } from "../extract/parsers/salary";
import { htmlToText, truncate } from "../libs/text";
import { compactFields, derived, fromText } from "./fields";
import type { Item, SourceAdapter } from "./types";

const HnParams = z.object({
  /** "latest" or a specific thread's item id. */
  thread: z.string().default("latest"),
});
type HnParams = z.infer<typeof HnParams>;

interface HnItem {
  id: number;
  title?: string;
  text: string | null;
  author?: string;
  created_at: string;
  children: HnItem[];
}

const ALGOLIA = "https://hn.algolia.com/api/v1";
export const hnPermalink = (id: number | string) => `https://news.ycombinator.com/item?id=${id}`;

/**
 * Hacker News "Ask HN: Who is hiring?" via the Algolia API. Each top-level comment is one
 * posting. Structured headers are parsed deterministically (REGEX evidence); comments
 * without a usable header carry only their text, for the LLM extraction rung.
 */
export const hnWhoIsHiring: SourceAdapter<HnParams> = {
  id: "hn_whoishiring",
  kind: "text",
  params: HnParams,
  provides: {
    company: "REGEX",
    title: "REGEX",
    location: "REGEX",
    remote: "REGEX",
    salary: "REGEX",
    employment_type: "REGEX",
    url: "REGEX",
    posted_at: "API",
    description: "REGEX",
  },

  async collect({ fetcher, scope }, { thread }) {
    const threadId = thread === "latest" ? await latestThreadId({ fetcher, scope }) : thread;
    const { data, page } = await fetcher.json<HnItem>(scope, `${ALGOLIA}/items/${threadId}`, "hn thread", { maxBytes: 20 * 1024 * 1024 });

    return data.children
      .filter((c) => c.text)
      .map((comment): Item => {
        const text = htmlToText(comment.text!);
        const permalink = hnPermalink(comment.id);
        const source = { sourceUrl: permalink, pageId: page.pageId };
        const headerLine = text.split("\n")[0] ?? "";
        const header = parseHnHeader(headerLine);
        const segment = (kind: string) => header?.segments.find((s) => s.kind === kind)?.text ?? "";

        const fields = header
          ? compactFields({
              company: fromText(header.company, header.segments[0]!.text, text, source),
              title: fromText(header.role, segment("role"), text, source),
              location: fromText(header.location, header.location ?? "", text, source),
              remote: fromText(header.arrangement, segment("arrangement"), text, source),
              salary: header.salary ? fromText(formatSalary(header.salary), header.salary.raw, text, source) : undefined,
              employment_type: fromText(header.employment, segment("employment"), text, source),
              // The company's own link when the header has one, otherwise the post itself.
              url: header.url
                ? fromText(header.url, header.url, text, source)
                : derived(permalink, `Hacker News comment ${comment.id}`, "post permalink", permalink, page.pageId),
              posted_at: derived(comment.created_at, comment.created_at, "comment timestamp", permalink, page.pageId),
              description: fromText(truncate(text, 500), text.slice(0, 300), text, source),
            })
          : {};

        return {
          externalId: String(comment.id),
          fields,
          text: { plain: text, sourceUrl: permalink, pageId: page.pageId },
          meta: { companyTags: [], author: comment.author ?? null, parsedHeader: Boolean(header), threadId },
        };
      });
  },
};

/** Finds the most recent "Who is hiring?" thread posted by the whoishiring account. */
async function latestThreadId({ fetcher, scope }: Parameters<SourceAdapter<HnParams>["collect"]>[0]): Promise<string> {
  const { data } = await fetcher.json<{ hits: Array<{ objectID: string; title: string }> }>(
    scope,
    `${ALGOLIA}/search_by_date?tags=story,author_whoishiring&hitsPerPage=10`,
    "hn thread lookup",
  );
  const thread = data.hits.find((h) => /who is hiring/i.test(h.title));
  if (!thread) throw new Error("No 'Who is hiring?' thread found on Hacker News");
  return thread.objectID;
}
