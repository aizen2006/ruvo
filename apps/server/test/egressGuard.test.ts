import { afterAll, describe, expect, test } from "bun:test";
import { once } from "node:events";
import { connect, type AddressInfo } from "node:net";
import { startEgressGuard } from "../src/fetch/egressGuard";

const guard = startEgressGuard({ host: "127.0.0.1", port: 0 });
await once(guard, "listening");
const { port } = guard.address() as AddressInfo;
afterAll(() => guard.close());

/** Speaks SOCKS5 to the guard: greeting, then `request`; resolves with the reply code (REP). */
async function socksReply(request: number[]): Promise<number> {
  const socket = connect(port, "127.0.0.1");
  await once(socket, "connect");
  socket.write(Buffer.from([5, 1, 0])); // version 5, one method: no authentication
  const [choice] = (await once(socket, "data")) as [Buffer];
  expect([...choice]).toEqual([5, 0]);
  socket.write(Buffer.from(request));
  const [reply] = (await once(socket, "data")) as [Buffer];
  socket.destroy();
  return reply[1]!;
}

const port80 = [0, 80];
const ipv4 = (address: number[], cmd = 1) => [5, cmd, 0, 1, ...address, ...port80];
const domain = (name: string) => [5, 1, 0, 3, name.length, ...Buffer.from(name), ...port80];
const ipv6Loopback = [5, 1, 0, 4, ...Array(15).fill(0), 1, ...port80];

describe("egress guard", () => {
  test.each([
    ["loopback", ipv4([127, 0, 0, 1])],
    ["a private address", ipv4([10, 0, 0, 1])],
    ["cloud metadata", ipv4([169, 254, 169, 254])],
    ["localhost by name", domain("localhost")],
    ["IPv6 loopback", ipv6Loopback],
  ])("refuses %s as not allowed (2)", async (_name, request) => {
    expect(await socksReply(request)).toBe(2);
  });

  test("an unresolvable name is host unreachable (4)", async () => {
    expect(await socksReply(domain("nothing-here.invalid"))).toBe(4);
  });

  test("a command other than CONNECT is not supported (7)", async () => {
    expect(await socksReply(ipv4([8, 8, 8, 8], 2))).toBe(7); // BIND
  });
});
