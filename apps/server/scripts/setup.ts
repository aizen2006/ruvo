/**
 * Local setup, safe to re-run: `bun run setup` from the repo root.
 * Creates the env files from their templates, starts Postgres, applies migrations,
 * installs Chromium for Playwright, then checks every dependency (`bun run doctor`).
 */
import { $ } from "bun";
import { existsSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = join(import.meta.dir, "..", "..", "..");
const server = join(root, "apps", "server");

const envFiles = [
  { template: join(server, ".env.example"), target: join(server, ".env"), note: "set OPENAI_API_KEY in it" },
  { template: join(root, "apps", "web", ".env.example"), target: join(root, "apps", "web", ".env.local"), note: "" },
];
for (const { template, target, note } of envFiles) {
  if (existsSync(target)) continue;
  await copyFile(template, target);
  console.log(`Created ${relative(root, target)} from its template${note ? `; ${note}` : ""}.`);
}

console.log("\nStarting Postgres...");
await $`docker compose up -d --wait`.cwd(root);
console.log("\nApplying migrations...");
await $`bun run db:migrate`.cwd(server);
console.log("\nInstalling Chromium for Playwright...");
await $`bun run browsers`.cwd(server);
console.log("\nChecking dependencies...");
const doctor = await $`bun run smoke`.cwd(server).nothrow();
console.log(
  doctor.exitCode === 0
    ? "\nReady. Run `bun run dev` and open http://localhost:3001/new"
    : "\nFix the failed checks above, then run `bun run doctor` again.",
);
