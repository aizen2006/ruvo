import { describe, expect, test } from "bun:test";
import { joinLocations, locationBucket } from "../src/extract/parsers/location";
import { arrangementFromWorkplaceType, detectArrangement } from "../src/extract/parsers/remote";
import { formatSalary, parseSalary } from "../src/extract/parsers/salary";
import { decodeEntities, htmlToText, truncate } from "../src/libs/text";
import { canonicalUrl } from "../src/libs/url";

describe("parseSalary", () => {
  test.each([
    ["$120k-$160k", 120_000, 160_000, "USD", "year"],
    ["$120K – $160K", 120_000, 160_000, "USD", "year"],
    ["$180,000 - $250,000", 180_000, 250_000, "USD", "year"],
    ["The base salary range is $180,000—$250,000 USD.", 180_000, 250_000, "USD", "year"],
    ["€75k–110k", 75_000, 110_000, "EUR", "year"],
    ["£60,000 per year", 60_000, 60_000, "GBP", "year"],
    ["120-150k GBP", 120_000, 150_000, "GBP", "year"],
    ["USD 200,000 to 250,000", 200_000, 250_000, "USD", "year"],
    ["CA$140k - CA$170k", 140_000, 170_000, "CAD", "year"],
    ["₹30,00,000 - ₹45,00,000 per annum", 3_000_000, 4_500_000, "INR", "year"],
    ["INR 2500000", 2_500_000, 2_500_000, "INR", "year"],
    ["$85/hr", 85, 85, "USD", "hour"],
    ["$60 - $90 per hour", 60, 90, "USD", "hour"],
    ["$12,000/month", 12_000, 12_000, "USD", "month"],
    ["Pay: 150k-200k", 150_000, 200_000, null, "year"],
    ["Salary: €90.000 – €110.000", 90_000, 110_000, "EUR", "year"],
    ["Remote (EU) | €75k–110k | Full-time", 75_000, 110_000, "EUR", "year"],
  ])("%s", (text, min, max, currency, period) => {
    expect(parseSalary(text)).toMatchObject({ min, max, currency, period });
  });

  test.each([
    "Competitive salary and equity",
    "We offer a 401(k) with 4% match",
    "401k matching",
    "We raised $300M in our Series C",
    "Join our team of 120-150 engineers",
    "Founded in 2019",
    "Every employee gets a $100 monthly wellness stipend and $500 for books",
  ])("finds no salary in %p", (text) => {
    expect(parseSalary(text)).toBeNull();
  });

  test("keeps the matched text as evidence", () => {
    expect(parseSalary("Compensation: $150k - $200k plus equity")?.raw).toBe("$150k - $200k");
  });

  test("formats ranges for display", () => {
    expect(formatSalary({ min: 120_000, max: 160_000, currency: "USD", period: "year" })).toBe("USD 120,000–160,000 / year");
    expect(formatSalary({ min: 85, max: 85, currency: null, period: "hour" })).toBe("85 / hour");
  });
});

describe("work arrangement", () => {
  test.each([
    ["Remote - India", "remote"],
    ["San Francisco, CA (Hybrid)", "hybrid"],
    ["Remote-friendly, hybrid in NYC", "hybrid"],
    ["New York, NY - on-site", "onsite"],
    ["No remote. Berlin office.", "onsite"],
    ["Work from anywhere", "remote"],
    ["San Francisco, CA", null],
  ])("%s → %p", (text, expected) => {
    expect(detectArrangement(text)).toBe(expected as ReturnType<typeof detectArrangement>);
  });

  test.each([
    ["Remote", "remote"],
    ["OnSite", "onsite"],
    ["hybrid", "hybrid"],
    ["unspecified", null],
    [null, null],
  ])("workplaceType %p → %p", (value, expected) => {
    expect(arrangementFromWorkplaceType(value)).toBe(expected as ReturnType<typeof arrangementFromWorkplaceType>);
  });
});

describe("locations", () => {
  test("joins and dedupes", () => {
    expect(joinLocations(["San Francisco, CA", " ", "san francisco, ca", "New York, NY", null])).toBe(
      "San Francisco, CA; New York, NY",
    );
  });

  test.each([
    ["San Francisco, CA; New York, NY", "san francisco"],
    ["Remote - US", "remote"],
    ["London / Remote (UK)", "remote"],
    [null, "unknown"],
  ])("bucket %p → %p", (location, bucket) => {
    expect(locationBucket(location)).toBe(bucket);
  });
});

describe("canonicalUrl", () => {
  test.each([
    ["https://boards.greenhouse.io/anthropic/jobs/123?gh_src=abc", "https://job-boards.greenhouse.io/anthropic/jobs/123"],
    ["https://jobs.lever.co/palantir/6ed7/apply?lever-source=LinkedIn", "https://jobs.lever.co/palantir/6ed7"],
    ["http://WWW.Example.com/Jobs/?utm_source=x&b=2&a=1#top", "https://example.com/Jobs?a=1&b=2"],
    ["https://example.com/", "https://example.com"],
    ["mailto:jobs@example.com", null],
    ["not a url", null],
  ])("%s", (raw, expected) => {
    expect(canonicalUrl(raw)).toBe(expected);
  });
});

describe("text helpers", () => {
  test("htmlToText keeps block boundaries and decodes entities", () => {
    expect(htmlToText("<p>Build <b>backend</b> &amp; infra</p><ul><li>Go</li><li>Rust</li></ul>")).toBe(
      "Build backend & infra\nGo\nRust",
    );
  });

  test("decodeEntities unescapes API-escaped HTML", () => {
    expect(decodeEntities("&lt;p&gt;Hi &amp;amp; bye&lt;/p&gt;")).toBe("<p>Hi &amp; bye</p>");
    expect(htmlToText(decodeEntities("&lt;p&gt;Hello&lt;/p&gt;"))).toBe("Hello");
  });

  test("truncate cuts on a word boundary", () => {
    expect(truncate("backend engineer for inference", 20)).toBe("backend engineer…");
    expect(truncate("short", 20)).toBe("short");
  });
});
