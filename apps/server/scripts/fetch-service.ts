/**
 * Runs RUVO's Scrapling fetch service natively for development: `bun scripts/fetch-service.ts`.
 * Starts the egress guard on 127.0.0.1:1080, then infra/scrapling/server.py with your own Scrapling,
 * which sends every connection it makes through the guard. The service stops when this script does.
 */
import { $ } from "bun";
import { once } from "node:events";
import { join } from "node:path";
import { env } from "../src/config/env";
import { startEgressGuard } from "../src/fetch/egressGuard";

if (!env.SCRAPLING_URL) {
  console.log("SCRAPLING_URL is blank, so the Scrapling fetch service stays off.");
  process.exit(0);
}
const serviceUrl = new URL(env.SCRAPLING_URL);
const python = env.SCRAPLING_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
// scrapling[all] also brings the service's web server (starlette, uvicorn).
const installed = await $`${python} -c ${"import scrapling, starlette, uvicorn"}`.quiet().nothrow();
if (installed.exitCode !== 0) {
  console.error(
    `Scrapling is not installed for "${python}". Run pip install "scrapling[all]", then scrapling install ` +
      "(or set SCRAPLING_PYTHON to a Python that has it).",
  );
  process.exit(1);
}

const guard = { host: "127.0.0.1", port: 1080 };
await once(startEgressGuard(guard), "listening");

// The service gets only what Python and its browsers need (Playwright keeps them under LOCALAPPDATA on Windows):
// none of RUVO's secrets, and no setting such as NO_PROXY that would send its connections around the guard.
const INHERITED = ["PATH", "SYSTEMROOT", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"];
const service = Bun.spawn([python, join(import.meta.dir, "..", "..", "..", "infra", "scrapling", "server.py")], {
  env: {
    ...Object.fromEntries(INHERITED.map((name) => [name, process.env[name]])),
    EGRESS_PROXY: `socks5://${guard.host}:${guard.port}`,
    SCRAPLING_HOST: "127.0.0.1",
    SCRAPLING_PORT: serviceUrl.port || "80", // an empty port means the scheme's default
    PYTHONUNBUFFERED: "1", // pass its output through as it is written
  },
  stdio: ["ignore", "inherit", "inherit"],
});
process.on("exit", () => service.kill());
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => process.exit(0));

console.error(`The Scrapling fetch service stopped (exit code ${await service.exited}).`);
process.exit(1);
