import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { FetchError } from "./errors";

/**
 * Server-side request forgery guard for user-supplied URLs: only http(s), and the host
 * must not resolve to a private, loopback, link-local or otherwise internal address.
 * Re-run it on every redirect hop, since a public URL can redirect inward.
 */
export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new FetchError("ssrf_blocked", `Invalid URL: ${rawUrl}`, { url: rawUrl });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FetchError("ssrf_blocked", `Unsupported scheme ${url.protocol}`, { url: rawUrl });
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (addresses.length === 0) {
    throw new FetchError("network", `Could not resolve ${host}`, { url: rawUrl });
  }
  const internal = addresses.find(isInternalAddress);
  if (internal) {
    throw new FetchError("ssrf_blocked", `${host} resolves to internal address ${internal}`, { url: rawUrl });
  }
  return url;
}

export function isInternalAddress(address: string): boolean {
  if (isIP(address) === 4) return isInternalV4(address);
  const v6 = address.toLowerCase();
  // IPv4-mapped IPv6 (::ffff:10.0.0.1) inherits the IPv4 rules.
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isInternalV4(mapped[1]!);
  return (
    v6 === "::" ||
    v6 === "::1" ||
    v6.startsWith("fc") || // unique local fc00::/7
    v6.startsWith("fd") ||
    /^fe[89ab]/.test(v6) // link-local fe80::/10
  );
}

function isInternalV4(address: string): boolean {
  const [a = 0, b = 0] = address.split(".").map(Number);
  return (
    a === 0 || // "this" network
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, incl. cloud metadata 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224 // multicast and reserved
  );
}
