import { describe, expect, test } from "bun:test";
import { assessHtml, hasChallengeMarkers, isBotChallenge } from "../src/fetch/sufficiency";

const jobs = Array.from({ length: 12 }, (_, i) => `<li class="job"><a href="/jobs/${i}">Backend Engineer ${i}</a><span>Remote</span></li>`).join("");
const staticPage = `<html><body><h1>Careers</h1><ul>${jobs}</ul><p>${"We build infrastructure. ".repeat(40)}</p></body></html>`;
const appShell = `<html><body><div id="root"></div><script>document.getElementById("root").innerHTML = "<ul>${jobs}</ul>";</script></body></html>`;
const challengePage = `<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><script>window._cf_chl_opt = { cType: 'managed' };</script></body></html>`;

describe("assessHtml", () => {
  test("a server-rendered page is sufficient", () => {
    expect(assessHtml(staticPage).sufficient).toBe(true);
  });

  test("an empty app shell needs a browser", () => {
    expect(assessHtml(appShell)).toMatchObject({ sufficient: false, reason: expect.stringContaining("characters of text") });
  });
});

describe("bot check detection", () => {
  test("the cf-mitigated header marks a challenge, whatever the body", () => {
    expect(isBotChallenge(403, { "cf-mitigated": "challenge" }, "")).toBe(true);
  });

  test.each(["<title>Just a moment...</title>", "window._cf_chl_opt = {}", "cType: 'managed'"])("the body marker %p marks a challenge", (marker) => {
    expect(isBotChallenge(503, {}, `<html>${marker}</html>`)).toBe(true);
    expect(hasChallengeMarkers(`<html>${marker}</html>`)).toBe(true);
  });

  test("a challenge needs a refusing status", () => {
    expect(isBotChallenge(200, { "cf-mitigated": "challenge" }, challengePage)).toBe(false);
    expect(isBotChallenge(404, {}, challengePage)).toBe(false);
  });

  test("an ordinary page loading Cloudflare's challenge platform or Turnstile is not a challenge", () => {
    const page = `<html><head><title>Sign in</title><script src="/cdn-cgi/challenge-platform/h/b/scripts/jsd/main.js"></script>
      <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script></head><body>${staticPage}</body></html>`;
    expect(hasChallengeMarkers(page)).toBe(false);
    expect(isBotChallenge(403, {}, page)).toBe(false);
  });
});
