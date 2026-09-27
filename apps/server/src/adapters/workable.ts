import { joinLocations } from "../extract/parsers/location";
import { detectArrangement } from "../extract/parsers/remote";
import { AtsParams } from "./ats";
import { compactFields, derived, fromApi } from "./fields";
import type { SourceAdapter } from "./types";

interface WorkableJob {
  title: string;
  shortcode: string;
  url: string;
  telecommuting?: boolean;
  department?: string;
  employment_type?: string;
  published_on?: string;
  city?: string;
  state?: string;
  country?: string;
  locations?: Array<{ city?: string; region?: string; country?: string }>;
}

/**
 * Workable public widget API: apply.workable.com/api/v1/widget/accounts/{slug}.
 * It lists postings without descriptions; the board page itself is a JS app (see html_list).
 */
export const workable: SourceAdapter<AtsParams> = {
  id: "workable",
  kind: "api",
  params: AtsParams,
  provides: {
    company: "API",
    title: "API",
    location: "API",
    remote: "API",
    url: "API",
    department: "API",
    employment_type: "API",
    posted_at: "API",
  },

  async collect({ fetcher, scope }, { slug, company }) {
    const url = `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}`;
    const { data, page } = await fetcher.json<{ name?: string; jobs: WorkableJob[] }>(scope, url, `workable:${slug}`);

    return data.jobs.map((job, i) => {
      const path = `$.jobs[${i}]`;
      const jobUrl = job.url;
      const place = (p: { city?: string; region?: string; state?: string; country?: string }) =>
        [p.city, p.region ?? p.state, p.country].filter(Boolean).join(", ");
      const location = joinLocations(job.locations?.length ? job.locations.map(place) : [place(job)]);
      const inferred = detectArrangement(`${job.title} ${location}`);

      return {
        externalId: job.shortcode,
        fields: compactFields({
          company: fromApi(data.name ?? company, page, jobUrl, "$.name"),
          title: fromApi(job.title, page, jobUrl, `${path}.title`),
          location: fromApi(location, page, jobUrl, `${path}.locations`),
          remote: job.telecommuting
            ? fromApi("remote", page, jobUrl, `${path}.telecommuting`, "telecommuting: true")
            : derived(inferred, `${job.title} | ${location}`, "detectArrangement(title, location)", jobUrl, page.pageId),
          url: fromApi(jobUrl, page, jobUrl, `${path}.url`),
          department: fromApi(job.department, page, jobUrl, `${path}.department`),
          employment_type: fromApi(job.employment_type, page, jobUrl, `${path}.employment_type`),
          posted_at: fromApi(job.published_on, page, jobUrl, `${path}.published_on`),
        }),
        text: null,
        meta: {},
      };
    });
  },
};
