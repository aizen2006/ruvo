/**
 * Local setup, safe to re-run: `bun run setup` from the repo root.
 * Creates the env files from their templates and picks how the Scrapling fetch service runs: with a Python that has
 * Scrapling, else in Docker (the compose `fetch` profile), else in a Python that uv installs Scrapling for. Then, once
 * the ports it needs are free, starts Postgres and SearXNG, applies migrations and checks every dependency (`bun run doctor`).
 */
import { $ } from "bun";
import { existsSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { connect } from "node:net";
import { join, relative } from "node:path";
import { loadEnv } from "../src/config/envSchema";
import { createVenv, findPython } from "./python";

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

// Bun loads only the current directory's .env (the repo root's), so load the server's: RUVO's settings, and the
// ports docker compose reads from this process's environment (POSTGRES_PORT, SCRAPLING_PORT).
process.loadEnvFile(join(server, ".env"));
const env = loadEnv(process.env);

const docker = (await $`docker info`.quiet().nothrow()).exitCode === 0;
if (!docker) console.log("\nDocker isn't running, so setup can't start Postgres and SearXNG: install or start Docker Desktop.");

// How the fetch service runs: natively, with SCRAPLING_PYTHON or a Python found with Scrapling; else in Docker; else
// natively with Scrapling that uv installs in a venv.
const native = await findPython(env.SCRAPLING_PYTHON);
const hasUv = async () => (await $`uv --version`.quiet().nothrow()).exitCode === 0;
const fetchService = !env.SCRAPLING_URL ? "off" : native.scrapling || env.SCRAPLING_PYTHON ? "native" : docker ? "docker" : (await hasUv()) ? "uv" : "missing";
const installUv = process.platform === "win32" ? `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"` : "curl -LsSf https://astral.sh/uv/install.sh | sh";
const fetchServiceNote = {
  off: "SCRAPLING_URL is blank, so the fetch service stays off.",
  native: native.scrapling
    ? `The fetch service runs with Scrapling ${native.scrapling} in ${native.python}; \`bun run dev\` starts it.`
    : `The fetch service needs Scrapling in ${native.python} (${native.error}): pip install "scrapling[all]", then scrapling install`,
  docker: "No Python here has Scrapling, so the fetch service runs in Docker.",
  uv: "No Python here has Scrapling, so uv installs it in .venv for the fetch service.",
  missing:
    "No Python here has Scrapling, and there is neither Docker nor uv to run the fetch service with. Either:\n" +
    "  - install Docker Desktop (https://docs.docker.com/get-docker/), which runs it, Postgres and SearXNG;\n" +
    `  - or install uv (${installUv}), which setup installs Scrapling with;\n` +
    '  - or, in a Python 3.10+: pip install "scrapling[all]", then scrapling install, and set SCRAPLING_PYTHON to it.\n' +
    "Then run `bun run setup` again.",
}[fetchService];
console.log(`\n${fetchServiceNote}`);
const profiles = fetchService === "docker" ? ["--profile", "fetch"] : [];

// The ports the services need must be free, unless RUVO's own already hold them: this project's running containers,
// or a fetch service that answers (Docker's, or one `bun run dev` started).
const needed: { port: number; service: string }[] = [];
if (docker) {
  const { services } = (await $`docker compose ${profiles} config --format json`.cwd(root).json()) as {
    services: Record<string, { ports?: { published: string }[] }>;
  };
  const running = (await $`docker compose ${profiles} ps --services --status running`.cwd(root).text()).split("\n");
  for (const [service, { ports = [] }] of Object.entries(services)) {
    if (!running.includes(service)) needed.push(...ports.map(({ published }) => ({ port: Number(published), service: `docker compose's ${service}` })));
  }
}
const answers = (url: string) => fetch(new URL("/health", url), { signal: AbortSignal.timeout(3_000) }).then((res) => res.ok, () => false);
if (env.SCRAPLING_URL && (fetchService === "native" || fetchService === "uv") && !(await answers(env.SCRAPLING_URL))) {
  needed.push({ port: Number(new URL(env.SCRAPLING_URL).port || 80), service: "the fetch service" }, { port: env.EGRESS_PORT, service: "its egress guard" });
}
const taken: string[] = [];
for (const { port, service } of needed) if (await portTaken(port)) taken.push(`Port ${port}, for ${service}, is taken by another program.`);
if (taken.length) {
  console.log(`\n${taken.join("\n")}`);
  console.log("Free it, or move RUVO's: set POSTGRES_PORT (and DATABASE_URL to match), SCRAPLING_PORT or EGRESS_PORT in apps/server/.env.");
  process.exit(1);
}

if (fetchService === "uv") await createVenv();
if (docker) {
  console.log(`\nStarting Postgres and SearXNG${profiles.length ? ", and the fetch service: the first time, Docker downloads its image and browsers" : ""}...`);
  await $`docker compose ${profiles} up -d --wait`.cwd(root);
}
console.log("\nApplying migrations...");
await $`bun run db:migrate`.cwd(server);
console.log("\nChecking dependencies...");
const doctor = await $`bun run smoke`.cwd(server).nothrow();
console.log(
  doctor.exitCode === 0
    ? "\nReady. Run `bun run dev` and open http://localhost:3001/new"
    : "\nFix the failed checks above, then run `bun run doctor` again.",
);

/** Whether a program already accepts connections on this machine's port. */
function portTaken(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1")
      .once("connect", () => (socket.destroy(), resolve(true)))
      .once("error", () => resolve(false));
  });
}
