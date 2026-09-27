import { joinLocations } from "../extract/parsers/location";
import { arrangementFromWorkplaceType, detectArrangement } from "../extract/parsers/remote";
import { htmlToText, truncate } from "../libs/text";
import { ATS_BOARD_URL, ATS_MAX_BYTES, AtsParams, periodFromInterval } from "./ats";
import { compactFields, derived, fromApi, salaryFromApi } from "./fields";
import type { SourceAdapter } from "./types";

interface LeverJob {
  id: string;
  text: string;
  hostedUrl: string;
  categories?: { location?: string; allLocations?: string[]; team?: string; commitment?: string; department?: string };
  workplaceType?: string;
  createdAt?: number;
  descriptionPlain?: string;
  lists?: Array<{ text: string; content: string }>;
  additionalPlain?: string;
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string } | null;
}

/** Lever public postings API: api.lever.co/v0/postings/{slug}?mode=json */
export const lever: SourceAdapter<AtsParams> = {
  id: "lever",
  kind: "api",
  params: AtsParams,
  provides: {
    company: "DERIVED",
    title: "API",
    location: "API",
    remote: "API",
    salary: "API",
    url: "API",
    department: "API",
    employment_type: "API",
    posted_at: "API",
    description: "API",
  },

  async collect({ fetcher, scope }, { slug, company }) {
    const url = ATS_BOARD_URL.lever(slug);
    const { data, page } = await fetcher.json<LeverJob[]>(scope, url, `lever:${slug}`, { maxBytes: ATS_MAX_BYTES });

    return data.map((job, i) => {
      const path = `$[${i}]`;
      const jobUrl = job.hostedUrl;
      const categories = job.categories ?? {};
      const location = joinLocations(categories.allLocations?.length ? categories.allLocations : [categories.location]);
      const arrangement = arrangementFromWorkplaceType(job.workplaceType);
      const salary = job.salaryRange;
      const description = [
        job.descriptionPlain,
        ...(job.lists ?? []).map((l) => `${l.text}\n${htmlToText(l.content)}`),
        job.additionalPlain,
      ]
        .filter(Boolean)
        .join("\n\n");

      return {
        externalId: job.id,
        fields: compactFields({
          company: derived(company, `jobs.lever.co/${slug}`, "registry board owner", jobUrl, page.pageId),
          title: fromApi(job.text, page, jobUrl, `${path}.text`),
          location: fromApi(location, page, jobUrl, `${path}.categories.allLocations`),
          remote: arrangement
            ? fromApi(arrangement, page, jobUrl, `${path}.workplaceType`, job.workplaceType)
            : derived(detectArrangement(location), location, "detectArrangement(location)", jobUrl, page.pageId),
          salary: salary
            ? salaryFromApi(
                { min: salary.min ?? null, max: salary.max ?? null, currency: salary.currency ?? null, period: periodFromInterval(salary.interval) },
                page,
                jobUrl,
                `${path}.salaryRange`,
              )
            : undefined,
          url: fromApi(jobUrl, page, jobUrl, `${path}.hostedUrl`),
          department: fromApi(categories.team ?? categories.department, page, jobUrl, `${path}.categories.team`),
          employment_type: fromApi(categories.commitment, page, jobUrl, `${path}.categories.commitment`),
          posted_at: job.createdAt
            ? fromApi(new Date(job.createdAt).toISOString(), page, jobUrl, `${path}.createdAt`, String(job.createdAt))
            : undefined,
          description: fromApi(truncate(description, 500), page, jobUrl, `${path}.descriptionPlain`),
        }),
        text: description ? { plain: description, sourceUrl: jobUrl, pageId: page.pageId } : null,
        meta: { team: categories.team ?? null },
      };
    });
  },
};
