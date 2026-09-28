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

/** True when the host (a name or an IP literal) resolves to an internal address, or cannot be resolved. */
export async function resolvesInternally(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return isInternalAddress(host);
  const addresses = (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  return addresses.length === 0 || addresses.some(isInternalAddress);
}

export function isInternalAddress(address: string): boolean {
  if (isIP(address) === 4) return isInternalV4(address);
  const h = ipv6Hextets(address);
  if (!h) return true; // unparseable: fail closed
  const zeros = (from: number, to: number) => h.slice(from, to).every((x) => x === 0);
  const v4 = (hi: number, lo: number) => isInternalV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);

  if (zeros(0, 8) || (zeros(0, 7) && h[7] === 1)) return true; // :: and ::1
  // Forms that carry an IPv4 address inherit the IPv4 rules, whichever way they are written.
  if (zeros(0, 5) && h[5] === 0xffff) return v4(h[6]!, h[7]!); // IPv4-mapped ::ffff:a.b.c.d
  if (zeros(0, 6)) return v4(h[6]!, h[7]!); // IPv4-compatible ::a.b.c.d
  if (h[0] === 0x64 && h[1] === 0xff9b && zeros(2, 6)) return v4(h[6]!, h[7]!); // NAT64 64:ff9b::/96
  if (h[0] === 0x2002) return v4(h[1]!, h[2]!); // 6to4 2002::/16
  return (
    (h[0]! & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (h[0]! & 0xffc0) === 0xfe80 || // link-local fe80::/10
    h[0]! >= 0xff00 // multicast
  );
}

/** The eight 16-bit groups of an IPv6 address (handles "::" and a dotted IPv4 tail), or null. */
function ipv6Hextets(address: string): number[] | null {
  let a = address.toLowerCase().split("%")[0]!;
  const dotted = /^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(a);
  if (dotted) {
    const [p, q, r, t] = dotted.slice(2).map(Number) as [number, number, number, number];
    a = `${dotted[1]}${((p << 8) | q).toString(16)}:${((r << 8) | t).toString(16)}`;
  }
  const halves = a.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const parts = halves.length === 2 ? [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail] : head;
  if (parts.length !== 8 || parts.some((x) => !/^[0-9a-f]{1,4}$/.test(x))) return null;
  return parts.map((x) => parseInt(x, 16));
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
