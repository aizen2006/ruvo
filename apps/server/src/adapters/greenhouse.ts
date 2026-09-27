import { joinLocations } from "../extract/parsers/location";
import { arrangementFromWorkplaceType, detectArrangement } from "../extract/parsers/remote";
import { decodeEntities, htmlToText, truncate } from "../libs/text";
import { ATS_BOARD_URL, ATS_MAX_BYTES, AtsParams } from "./ats";
import { compactFields, derived, fromApi } from "./fields";
import type { SourceAdapter } from "./types";

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  company_name?: string;
  location?: { name?: string };
  metadata?: Array<{ name: string; value: unknown }> | null;
  departments?: Array<{ name: string }>;
  first_published?: string;
  updated_at?: string;
  /** HTML description, entity-escaped by the API. */
  content?: string;
}

/** Greenhouse public job board API: boards-api.greenhouse.io/v1/boards/{slug}/jobs */
export const greenhouse: SourceAdapter<AtsParams> = {
  id: "greenhouse",
  kind: "api",
  params: AtsParams,
  provides: {
    company: "API",
    title: "API",
    location: "API",
    remote: "API",
    url: "API",
    department: "API",
    posted_at: "API",
    description: "API",
  },

  async collect({ fetcher, scope }, { slug, company }) {
    const url = ATS_BOARD_URL.greenhouse(slug);
    const { data, page } = await fetcher.json<{ jobs: GreenhouseJob[] }>(scope, url, `greenhouse:${slug}`, {
      maxBytes: ATS_MAX_BYTES,
    });

    return data.jobs.map((job, i) => {
      const path = `$.jobs[${i}]`;
      const jobUrl = job.absolute_url;
      // Names like "NYC, NY; SF, CA | NYC, NY" repeat entries; split and dedupe them.
      const location = joinLocations((job.location?.name ?? "").split(/[|;]/)) || null;
      const description = job.content ? htmlToText(decodeEntities(job.content)) : "";

      // Boards commonly expose the arrangement as a custom "Location Type" metadata field.
      const typeIndex = (job.metadata ?? []).findIndex((m) => /location type|workplace|remote/i.test(m.name));
      const typeValue = typeIndex >= 0 ? String(job.metadata![typeIndex]!.value ?? "") : "";
      const arrangement = arrangementFromWorkplaceType(typeValue) ?? detectArrangement(typeValue);

      return {
        externalId: String(job.id),
        fields: compactFields({
          company: fromApi(job.company_name ?? company, page, jobUrl, `${path}.company_name`),
          title: fromApi(job.title, page, jobUrl, `${path}.title`),
          location: fromApi(location, page, jobUrl, `${path}.location.name`),
          remote: arrangement
            ? fromApi(arrangement, page, jobUrl, `${path}.metadata[${typeIndex}].value`, typeValue)
            : derived(detectArrangement(location ?? ""), location ?? "", "detectArrangement(location)", jobUrl, page.pageId),
          url: fromApi(jobUrl, page, jobUrl, `${path}.absolute_url`),
          department: fromApi(job.departments?.[0]?.name, page, jobUrl, `${path}.departments[0].name`),
          posted_at: fromApi(job.first_published, page, jobUrl, `${path}.first_published`),
          description: fromApi(truncate(description, 500), page, jobUrl, `${path}.content`),
        }),
        text: description ? { plain: description, sourceUrl: jobUrl, pageId: page.pageId } : null,
        meta: { departments: job.departments?.map((d) => d.name) ?? [] },
      };
    });
  },
};
