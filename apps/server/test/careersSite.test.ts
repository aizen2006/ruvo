import { afterAll, describe, expect, test } from "bun:test";
import { replayRecipe } from "../src/recipes/replay";
import { startTestServer } from "./helpers/http";

const api = startTestServer();
afterAll(async () => {
  await api.post("/fixtures/careers/version", { version: 1 });
  api.close();
});

const v1Recipe = {
  itemSelector: "div.job-card",
  fields: [{ name: "title", selector: "h3.job-title", attr: "text", transform: "trim" as const }],
};

describe("demo careers site", () => {
  test("a redesign keeps the URL but breaks the version-1 recipe", async () => {
    const before = await (await api.raw("/fixtures/careers")).text();
    expect(replayRecipe(before, "http://localhost/fixtures/careers", v1Recipe).itemCount).toBe(8);

    expect((await api.post("/fixtures/careers/version", { version: 2 })).body).toEqual({ version: 2 });
    const after = await (await api.raw("/fixtures/careers")).text();
    expect(after).toContain('class="job-listing"');
    expect(replayRecipe(after, "http://localhost/fixtures/careers", v1Recipe).itemCount).toBe(0);
  });

  test("rejects unknown versions", async () => {
    expect((await api.post("/fixtures/careers/version", { version: 3 })).status).toBe(400);
  });
});
