/**
 * Local setup, safe to re-run: `bun run setup` from the repo root.
 * Creates the env files from their templates, checks that Python can run the Scrapling fetch service,
 * starts Postgres and SearXNG, applies migrations, then checks every dependency (`bun run doctor`).
 */
import { $ } from "bun";
import { existsSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = join(import.meta.dir, "..", "..", "..");
const server = join(root, "apps", "server");

const envFiles = [
  { template: join(server, ".env.example"), target: join(server, ".env"), note: "set OPENAI_API_KEY in it, or sign in with ChatGPT on the dashboard's Settings page instead (see the README)" },
  { template: join(root, "apps", "web", ".env.example"), target: join(root, "apps", "web", ".env.local"), note: "" },
];
for (const { template, target, note } of envFiles) {
  if (existsSync(target)) continue;
  await copyFile(template, target);
  console.log(`Created ${relative(root, target)} from its template${note ? `; ${note}` : ""}.`);
}

// Bun loads only the current directory's .env (the repo root's), so read SCRAPLING_PYTHON from the server's.
process.loadEnvFile(join(server, ".env"));
const python = process.env.SCRAPLING_PYTHON || (process.platform === "win32" ? "python" : "python3");
const scrapling = await $`${python} -c "import scrapling, starlette, uvicorn"`.quiet().nothrow();
if (scrapling.exitCode !== 0) {
  console.log(`\nThe fetch service needs Scrapling in ${python}: pip install "scrapling[all]", then scrapling install`);
}

console.log("\nStarting Postgres and SearXNG...");
await $`docker compose up -d --wait`.cwd(root);
console.log("\nApplying migrations...");
await $`bun run db:migrate`.cwd(server);
console.log("\nChecking dependencies...");
const doctor = await $`bun run smoke`.cwd(server).nothrow();
console.log(
  doctor.exitCode === 0
    ? "\nReady. Run `bun run dev`, which also starts the fetch service, and open http://localhost:3001/new"
    : "\nFix the failed checks above, then run `bun run doctor` again.",
);
