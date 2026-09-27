import { joinLocations } from "../extract/parsers/location";
import { arrangementFromWorkplaceType, detectArrangement } from "../extract/parsers/remote";
import { truncate } from "../libs/text";
import { ATS_MAX_BYTES, AtsParams, humanizeEmploymentType, periodFromInterval } from "./ats";
import { compactFields, derived, fromApi, salaryFromApi } from "./fields";
import type { SourceAdapter } from "./types";

interface AshbyCompensationComponent {
  compensationType: string;
  interval: string;
  currencyCode: string | null;
  minValue: number | null;
  maxValue: number | null;
}

interface AshbyJob {
  id: string;
  title: string;
  jobUrl: string;
  department?: string | null;
  team?: string | null;
  employmentType?: string | null;
  location?: string | null;
  secondaryLocations?: Array<{ location?: string | null }>;
  publishedAt?: string | null;
  isListed?: boolean;
  isRemote?: boolean | null;
  workplaceType?: string | null;
  descriptionPlain?: string | null;
  compensation?: { summaryComponents?: AshbyCompensationComponent[] } | null;
}

/** Ashby public posting API: api.ashbyhq.com/posting-api/job-board/{slug} */
export const ashby: SourceAdapter<AtsParams> = {
  id: "ashby",
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
    const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`;
    const { data, page } = await fetcher.json<{ jobs: AshbyJob[] }>(scope, url, `ashby:${slug}`, {
      maxBytes: ATS_MAX_BYTES,
    });

    return data.jobs.flatMap((job, i) => {
      if (job.isListed === false) return [];
      const path = `$.jobs[${i}]`;
      const jobUrl = job.jobUrl;
      const location = joinLocations([job.location, ...(job.secondaryLocations ?? []).map((l) => l.location)]);

      const arrangement = arrangementFromWorkplaceType(job.workplaceType) ?? (job.isRemote ? "remote" : null);
      const arrangementPath = job.workplaceType ? `${path}.workplaceType` : `${path}.isRemote`;

      const components = job.compensation?.summaryComponents ?? [];
      const salaryIndex = components.findIndex((c) => c.compensationType === "Salary");
      const salary = components[salaryIndex];

      return [
        {
          externalId: job.id,
          fields: compactFields({
            // The board belongs to the company, so its name comes from our registry entry.
            company: derived(company, `jobs.ashbyhq.com/${slug}`, "registry board owner", jobUrl, page.pageId),
            title: fromApi(job.title, page, jobUrl, `${path}.title`),
            location: fromApi(location, page, jobUrl, `${path}.location`),
            remote: arrangement
              ? fromApi(arrangement, page, jobUrl, arrangementPath, String(job.workplaceType ?? job.isRemote))
              : derived(detectArrangement(location), location, "detectArrangement(location)", jobUrl, page.pageId),
            salary: salary
              ? salaryFromApi(
                  { min: salary.minValue, max: salary.maxValue, currency: salary.currencyCode, period: periodFromInterval(salary.interval) },
                  page,
                  jobUrl,
                  `${path}.compensation.summaryComponents[${salaryIndex}]`,
                )
              : undefined,
            url: fromApi(jobUrl, page, jobUrl, `${path}.jobUrl`),
            department: fromApi(job.department ?? job.team, page, jobUrl, `${path}.department`),
            employment_type: fromApi(humanizeEmploymentType(job.employmentType), page, jobUrl, `${path}.employmentType`),
            posted_at: fromApi(job.publishedAt, page, jobUrl, `${path}.publishedAt`),
            description: fromApi(truncate(job.descriptionPlain ?? "", 500), page, jobUrl, `${path}.descriptionPlain`),
          }),
          text: job.descriptionPlain ? { plain: job.descriptionPlain, sourceUrl: jobUrl, pageId: page.pageId } : null,
          meta: { team: job.team ?? null },
        },
      ];
    });
  },
};
