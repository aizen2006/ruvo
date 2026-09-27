import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { toPageState } from "../src/page/pageState";
import { isGeneratedClass } from "../src/page/selectors";
import { pageSkeleton } from "../src/page/skeleton";
import { jsonLdOfType } from "../src/page/structured";

const html = (name: string) => readFileSync(new URL(`./fixtures/html/${name}.html`, import.meta.url), "utf8");

describe("toPageState", () => {
  test("the Workable HTTP response is an empty shell", () => {
    const state = toPageState(html("workable-shell"), "https://apply.workable.com/huggingface/");
    expect(state.textLength).toBeLessThan(200);
    expect(state.groups).toEqual([]);
  });

  test("the rendered Workable board exposes the job list as a stable repeated group", () => {
    const state = toPageState(html("workable-rendered"), "https://apply.workable.com/huggingface/");
    const [top] = state.groups;
    expect(top).toMatchObject({ count: 8, fragile: false });
    expect(top!.selector).toContain('li[data-ui="job"]');
    expect(top!.samples[0]).toContain("Engineer");
    expect(state.links.some((l) => l.href.startsWith("https://apply.workable.com/huggingface/j/"))).toBe(true);
  });

  test("reads JSON-LD job postings from a Lever page", () => {
    const state = toPageState(html("lever-posting"), "https://jobs.lever.co/palantir/x");
    const [posting] = jsonLdOfType(state.jsonLd, "JobPosting");
    expect(posting?.title).toBeTruthy();
    expect(posting?.hiringOrganization).toBeTruthy();
  });

  test("reads embedded framework state from Ashby and Greenhouse pages", () => {
    expect(toPageState(html("ashby-board"), "https://jobs.ashbyhq.com/openai").embedded.map((e) => e.key)).toContain("__appData");
    expect(toPageState(html("greenhouse-job"), "https://job-boards.greenhouse.io/anthropic/jobs/1").embedded.map((e) => e.key)).toContain(
      "__remixContext",
    );
  });
});

describe("pageSkeleton", () => {
  test("outlines the page compactly, collapsing repeated items", () => {
    const skeleton = pageSkeleton(html("workable-rendered"));
    expect(skeleton).toContain('data-ui="job"');
    expect(skeleton).toContain("6 more like the above");
    expect(skeleton.length).toBeLessThan(12_500);
  });
});

describe("isGeneratedClass", () => {
  test.each([
    ["styles--1vo9F", true],
    ["css-1x2y3z", true],
    ["sc-bdVaJa", true],
    ["Card_root__a1B2c", true],
    ["job-card", false],
    ["posting", false],
    ["list-item", false],
  ])("%s → %p", (name, generated) => {
    expect(isGeneratedClass(name)).toBe(generated);
  });
});
