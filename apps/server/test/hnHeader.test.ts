import { describe, expect, test } from "bun:test";
import { parseHnHeader } from "../src/extract/parsers/hnHeader";

// Header lines from the September 2026 "Who is hiring?" thread.
describe("parseHnHeader", () => {
  test("classic pipe header with salary and link", () => {
    const h = parseHnHeader("Modash.io | Senior Product Engineer | Remote (Europe) | Full-time | €75k–110k | https://modash.io/careers");
    expect(h).toMatchObject({
      company: "Modash.io",
      role: "Senior Product Engineer",
      arrangement: "remote",
      location: "Remote (Europe)",
      employment: "Full-time",
      url: "https://modash.io/careers",
    });
    expect(h!.salary).toMatchObject({ min: 75_000, max: 110_000, currency: "EUR" });
  });

  test("segments in a different order", () => {
    const h = parseHnHeader("Quill | Fullstack SWE | Full-time | Remote, PT/ET hours preferred | $150 - 210K USD + equity");
    expect(h).toMatchObject({ company: "Quill", role: "Fullstack SWE", arrangement: "remote", employment: "Full-time" });
    expect(h!.salary).toMatchObject({ min: 150_000, max: 210_000, currency: "USD" });
  });

  test("location plus arrangement, hourly pay", () => {
    const h = parseHnHeader(
      "Noricum | Senior Backend Engineer, Payments, Ledger & Provable Fairness | REMOTE (2h overlap with US Pacific) | Contract to permanent | $120-160/hr",
    );
    expect(h).toMatchObject({ company: "Noricum", arrangement: "remote", employment: "Contract to permanent" });
    expect(h!.role).toStartWith("Senior Backend Engineer");
    expect(h!.salary).toMatchObject({ min: 120, max: 160, period: "hour" });
  });

  test("strips funding notes and markdown from the company", () => {
    expect(parseHnHeader("Monumint (YC W24) | Founding Engineer | San Francisco | ONSITE")?.company).toBe("Monumint");
    expect(parseHnHeader("*Fastly | Software Engineers (Senior, Staff, Principal) | US, UK, EU, APAC ONSITE PREFERRED | Full-time*")?.company).toBe("Fastly");
  });

  test("a header without a role still yields location and arrangement", () => {
    expect(parseHnHeader("yeet | Chicago, IL / Remote | Full-Time")).toMatchObject({
      company: "yeet",
      role: null,
      arrangement: "remote",
      location: "Chicago, IL / Remote",
    });
    expect(parseHnHeader("Shepherd (Series B) | ONSITE | San Francisco, CA")).toMatchObject({
      company: "Shepherd",
      arrangement: "onsite",
      location: "San Francisco, CA",
    });
  });

  test("multiple role segments are joined", () => {
    expect(parseHnHeader("Starbridge | Senior AI Engineer and Senior Product Engineer | NYC or Remote | Full-time")?.role).toBe(
      "Senior AI Engineer and Senior Product Engineer",
    );
  });

  test.each([
    "Rust developer/software engineer at NLnet foundation in Amsterdam",
    "Moyai Agent Reliability Engineering",
    "Aerdos | https://aerdos.com",
    "Please normalize | your headers",
  ])("returns null for prose or thin headers: %p", (line) => {
    expect(parseHnHeader(line)).toBeNull();
  });
});
