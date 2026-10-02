import { connect, createServer, type Server, type Socket } from "node:net";
import { env } from "../config/env";
import { logger } from "../libs/logger";
import { FetchError } from "./errors";
import { publicAddresses } from "./ssrf";

/**
 * SOCKS5 egress guard for the Scrapling service. Every connection its fetchers and browsers open
 * (loopback too, which Playwright proxies) must pass RUVO's private-network rules, and goes only to
 * the addresses that were checked, so DNS rebinding has no second lookup to change. It has no
 * authentication, so it must listen only where RUVO alone can reach it. CONNECT only: no BIND or UDP.
 */
export function startEgressGuard({ host, port }: { host: string; port: number }): Server {
  return createServer((client) => {
    client.on("error", () => client.destroy());
    client.once("data", (greeting) => {
      if (greeting[0] !== 5) return client.destroy();
      client.write(Buffer.from([5, 0])); // no authentication
      client.once("data", (request: Buffer) => tunnel(client, request).catch(() => client.destroy()));
    });
  }).listen(port, host, () => logger.info("Egress guard started", { host, port }));
}

/** Checks the requested target, then joins the client to it. */
async function tunnel(client: Socket, request: Buffer) {
  const reply = (code: number) => client.write(Buffer.from([5, code, 0, 1, 0, 0, 0, 0, 0, 0]));
  const target = parseConnect(request);
  if (!target) return void (reply(7), client.end()); // 7: command not supported

  const checked = await publicAddresses(target.host).catch((error: FetchError) => error);
  if (checked instanceof FetchError) {
    const internal = checked.kind === "ssrf_blocked";
    if (internal) logger.warn("Egress guard refused a connection", { port: target.port, reason: checked.message });
    return void (reply(internal ? 2 : 4), client.end()); // 2: not allowed by rule, 4: host unreachable
  }
  if (client.destroyed) return; // the client gave up during the check

  let open = false;
  const upstream = connect({
    host: target.host,
    port: target.port,
    autoSelectFamily: true,
    // No second DNS lookup: the connection may go only to the addresses just checked.
    lookup: (_host, options, done) =>
      options.all ? done(null, checked) : done(null, checked[0]!.address, checked[0]!.family),
  });
  upstream.on("connect", () => {
    open = true;
    reply(0);
    upstream.pipe(client);
    client.pipe(upstream);
  });
  upstream.on("error", () => (open ? client.destroy() : (reply(5), client.end()))); // 5: connection refused
  client.on("close", () => upstream.destroy());
}

/** Host and port of a SOCKS5 CONNECT request (VER CMD RSV ATYP ADDR PORT), or null for anything else. */
function parseConnect(b: Buffer): { host: string; port: number } | null {
  if (b[0] !== 5 || b[1] !== 1) return null;
  if (b[3] === 1) return { host: b.subarray(4, 8).join("."), port: b.readUInt16BE(8) };
  if (b[3] === 3) return { host: b.toString("latin1", 5, 5 + b[4]!), port: b.readUInt16BE(5 + b[4]!) };
  if (b[3] === 4) {
    const groups = Array.from({ length: 8 }, (_, i) => b.readUInt16BE(4 + 2 * i).toString(16));
    return { host: groups.join(":"), port: b.readUInt16BE(20) };
  }
  return null;
}

// Run on its own (`bun src/fetch/egressGuard.ts`): on every interface only inside a container.
if (import.meta.main) startEgressGuard({ host: env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1", port: 1080 });
