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

  // Each as the service sends it in place of the page.
  const botChecks = {
    DataDome: `<html><head><title>shop.example</title></head><body><script>var dd={'rt':'c','cid':'AHrlqAAAAAMA','hsh':'2211F5','t':'fe','host':'geo.captcha-delivery.com'}</script><script src="https://ct.captcha-delivery.com/c.js"></script></body></html>`,
    "PerimeterX (HUMAN)": `<html><head><title>Access to this page has been denied</title></head><body><div id="px-captcha"></div><p>Press &amp; Hold to confirm you are a human (and not a bot).</p></body></html>`,
    Akamai: `<HTML><HEAD>\n<TITLE>Access Denied</TITLE>\n</HEAD><BODY>\n<H1>Access Denied</H1>\nYou don't have permission to access "http&#58;&#47;&#47;shop&#46;example&#47;" on this server.<P>\nReference&#32;&#35;18&#46;c60ad717&#46;1511897450&#46;524468b7\n</BODY>\n</HTML>`,
  };
  const captchas = {
    reCAPTCHA: `<html><head><script src="https://www.google.com/recaptcha/api.js" async defer></script></head><body><p>Our systems have detected unusual traffic.</p><form method="post"><div class="g-recaptcha" data-sitekey="6Le"></div></form></body></html>`,
    hCaptcha: `<html><head><script src="https://js.hcaptcha.com/1/api.js" async defer></script></head><body><p>Please verify you are human.</p><div class="h-captcha" data-sitekey="10000"></div></body></html>`,
  };
  const walls = {
    "Google's consent wall": `<html><body><h1>Before you continue to Google</h1><form action="https://consent.google.com/save" method="POST"><input type="hidden" name="continue" value="https://www.google.com/"><button>Reject all</button></form></body></html>`,
    "YouTube's consent wall": `<html><body><h1>Before you continue to YouTube</h1><form action="https://consent.youtube.com/save" method="POST"><input type="hidden" name="set_eom" value="true"><button>Reject all</button></form></body></html>`,
    "Yahoo's consent wall": `<html><body><form method="post" class="consent-form" action="/v2/collectConsent?sessionId=3_cc-session_4e0d"><button name="reject" value="reject">Reject all</button></form></body></html>`,
    "LinkedIn's sign-in wall": `<html lang="en"><head><meta name="pageKey" content="auth_wall_desktop_profile"><title>Sign Up | LinkedIn</title><link rel="canonical" href="/authwall"></head><body><div class="authwall-sign-in-form"><h2>Sign in</h2></div></body></html>`,
  };

  test.each(Object.entries(botChecks))("%s: a challenge with a refusing status, and alone in a stealth result", (_, page) => {
    expect(isBotChallenge(403, {}, page)).toBe(true);
    expect(hasChallengeMarkers(page)).toBe(true);
  });

  test.each(Object.entries(captchas))("%s: a challenge only with a refusing status", (_, page) => {
    expect(isBotChallenge(429, {}, page)).toBe(true);
    // A form on a good page may carry one too.
    expect(isBotChallenge(200, {}, page)).toBe(false);
    expect(hasChallengeMarkers(page)).toBe(false);
  });

  test.each(Object.entries(walls))("%s: a challenge at HTTP 200", (_, page) => {
    expect(isBotChallenge(200, {}, page)).toBe(true);
    expect(hasChallengeMarkers(page)).toBe(true);
  });

  test("a good page that mentions logging in, links to a sign-in wall, asks for cookies or embeds a CAPTCHA is not a challenge", () => {
    const page = `<html><head><title>Careers at Shop</title><script src="https://js.datadome.co/tags.js" async></script>
      <script src="https://www.google.com/recaptcha/api.js" async defer></script></head><body>
      <div id="onetrust-banner-sdk"><p>We use cookies. <button>Accept all</button></p></div>
      <nav><a href="/login">Log in</a> <a href="https://www.linkedin.com/authwall?trk=gf&sessionRedirect=https%3A%2F%2Fwww.linkedin.com%2Fcompany%2Fshop">LinkedIn</a></nav>
      ${staticPage}<p>Sign in or create an account to apply. Access denied? Contact us.</p>
      <form action="/apply" method="post"><input type="password" name="password"><div class="g-recaptcha" data-sitekey="6Le"></div></form></body></html>`;
    expect(isBotChallenge(200, {}, page)).toBe(false);
    expect(hasChallengeMarkers(page)).toBe(false);
  });
});
