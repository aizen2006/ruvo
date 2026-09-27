import { describe, expect, test } from "bun:test";
import { loadEnv } from "../src/config/envSchema";

const minimal = { DATABASE_URL: "postgres://u:p@localhost:5432/db" };

describe("loadEnv", () => {
  test("applies defaults for everything but DATABASE_URL", () => {
    const env = loadEnv(minimal);
    expect(env.PORT).toBe(3000);
    expect(env.MODEL_PLANNER).toBe("gpt-6-sol");
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

  test("lists every invalid variable in one error", () => {
    expect(() => loadEnv({ DECIDER_PROVIDER: "gpt" })).toThrow(/DATABASE_URL[\s\S]*DECIDER_PROVIDER/);
  });
});
