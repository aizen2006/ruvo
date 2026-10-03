import { describe, expect, test } from "bun:test";
import { updateEnvText } from "../src/config/settings";

/** Lines as apps/server/.env.example writes them: comments, a blank key with a comment, a commented-out key. */
const ENV = `# --- OpenAI ---
OPENAI_API_KEY=              # when set, used instead of the ChatGPT sign-in
# MODEL_PLANNER=gpt-6-sol      # unset = the account's default
LLM_CACHE_MODE=on            # off | on | cache_only
MAX_BROWSER_PAGES=20
MAX_PAGES=300
`;

const WITH_KEY = `# --- OpenAI ---
OPENAI_API_KEY=sk-test-1234              # when set, used instead of the ChatGPT sign-in
# MODEL_PLANNER=gpt-6-sol      # unset = the account's default
LLM_CACHE_MODE=off            # off | on | cache_only
MAX_BROWSER_PAGES=20
MAX_PAGES=200
`;

describe("updateEnvText", () => {
  test("updates each key's line in place, keeping its comment and every other line", () => {
    expect(updateEnvText(ENV, { OPENAI_API_KEY: "sk-test-1234", LLM_CACHE_MODE: "off", MAX_PAGES: "200" })).toBe(WITH_KEY);
  });

  test("adds a key the file lacks at the end, leaving a commented-out line alone", () => {
    expect(updateEnvText(ENV, { MODEL_PLANNER: "gpt-6-astra" })).toBe(`${ENV}MODEL_PLANNER=gpt-6-astra\n`);
  });

  test("a blank value unsets a key and keeps its comment; unsetting a key the file lacks changes nothing", () => {
    expect(updateEnvText(WITH_KEY, { OPENAI_API_KEY: "", FIRECRAWL_API_KEY: "", LLM_CACHE_MODE: "on", MAX_PAGES: "300" })).toBe(ENV);
  });

  test("keeps Windows line endings", () => {
    const crlf = (text: string) => text.replaceAll("\n", "\r\n");
    expect(updateEnvText(crlf(ENV), { MAX_PAGES: "200", MODEL_WORKER: "gpt-6-luna" })).toBe(
      crlf(`${ENV.replace("MAX_PAGES=300", "MAX_PAGES=200")}MODEL_WORKER=gpt-6-luna\n`),
    );
  });
});
