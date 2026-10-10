import { describe, expect, test } from "bun:test";
import { loadEnv } from "../src/config/envSchema";

const minimal = { DATABASE_URL: "postgres://u:p@localhost:5432/db" };

describe("loadEnv", () => {
  test("applies defaults for everything but DATABASE_URL", () => {
    const env = loadEnv(minimal);
    expect(env.PORT).toBe(3000);
    // No API key: the ChatGPT plan's default.
    expect(env.MODEL_PLANNER).toBe("gpt-5.6-terra");
    expect(env.DECIDER_PROVIDER).toBe("jev");
    expect(env.WORKER_INLINE).toBe(false);
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  test("coerces numbers and flags", () => {
    const env = loadEnv({ ...minimal, PORT: "4000", MAX_LLM_CALLS: "5", WORKER_INLINE: "true" });
    expect(env.PORT).toBe(4000);
    expect(env.MAX_LLM_CALLS).toBe(5);
    expect(env.WORKER_INLINE).toBe(true);
  });

  test("treats empty secrets as unset", () => {
    expect(loadEnv({ ...minimal, OPENAI_API_KEY: "" }).OPENAI_API_KEY).toBeUndefined();
  });

  test("reads CORS_ORIGINS as origins, the published dashboard's by default", () => {
    expect(loadEnv(minimal).CORS_ORIGINS).toEqual(["http://localhost:3001"]);
    const origins = loadEnv({ ...minimal, CORS_ORIGINS: "https://ruvo.example.com/, http://10.0.0.5:3001" }).CORS_ORIGINS;
    expect(origins).toEqual(["https://ruvo.example.com", "http://10.0.0.5:3001"]);
    expect(() => loadEnv({ ...minimal, CORS_ORIGINS: "ruvo.example.com" })).toThrow(/CORS_ORIGINS/);
  });

  test("lists every invalid variable in one error", () => {
    expect(() => loadEnv({ DECIDER_PROVIDER: "gpt" })).toThrow(/DATABASE_URL[\s\S]*DECIDER_PROVIDER/);
  });
});
