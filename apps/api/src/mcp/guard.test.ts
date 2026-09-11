import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OutboundRefused,
  createGuardedFetch,
  isBlockedAddress,
  pinnedLookup,
  type GuardRule,
} from "./guard";

/**
 * The outbound guard, tested on its own (design D8).
 *
 * Address classes are a table against `isBlockedAddress`. Resolution is
 * injected, so "a public name that resolves somewhere private" is a fact the
 * test states rather than one it has to find on the internet. The rules that
 * need a real socket — redirects, the size cap, the timeout — run against a
 * local server reached through the exemption, which is the only way an
 * `http://127.0.0.1` server gets past rules 1 and 2 at all.
 */

async function refused(promise: Promise<unknown>, rule: GuardRule) {
  await expect(promise).rejects.toBeInstanceOf(OutboundRefused);
  await expect(promise).rejects.toMatchObject({ rule });
}

describe("address classes", () => {
  const blocked = [
    "127.0.0.1",
    "127.255.255.254",
    "::1",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "fc00::1",
    "fd12:3456::1",
    "169.254.0.1",
    "169.254.169.254",
    "fe80::1",
    "100.64.0.1",
    "100.127.255.255",
    "0.0.0.0",
    "::",
    "224.0.0.1",
    "239.255.255.250",
    "ff02::1",
    "255.255.255.255",
    "::ffff:10.0.0.1",
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
    "::ffff:a00:1",
    "not-an-address",
  ];
  const allowed = [
    "8.8.8.8",
    "1.1.1.1",
    "172.32.0.1",
    "100.128.0.1",
    "2606:4700:4700::1111",
    "::ffff:8.8.8.8",
  ];

  it.each(blocked)("blocks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(allowed)("allows %s", (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});

describe("refusals happen before anything is sent", () => {
  it("refuses plain http without resolving the host", async () => {
    let resolved = false;
    const guarded = createGuardedFetch({
      resolve: async () => {
        resolved = true;
        return [{ address: "8.8.8.8", family: 4 }];
      },
    });
    await refused(guarded("http://example.com/mcp"), "https-only");
    expect(resolved).toBe(false);
  });

  it("refuses a public-looking name that resolves to a private address", async () => {
    const guarded = createGuardedFetch({
      resolve: async () => [{ address: "10.0.0.5", family: 4 }],
    });
    await refused(guarded("https://innocent.example/mcp"), "private-address");
  });

  it("refuses when any one resolved address is internal", async () => {
    const guarded = createGuardedFetch({
      resolve: async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "169.254.169.254", family: 4 },
      ],
    });
    await refused(guarded("https://mixed.example/mcp"), "private-address");
  });

  // IP literals resolve locally, with no DNS query, so these use the real resolver.
  it.each([
    "https://127.0.0.1/mcp",
    "https://[::1]/mcp",
    "https://169.254.169.254/latest/meta-data",
    "https://[::ffff:10.0.0.1]/mcp",
    "https://2130706433/mcp",
    "https://0x7f.1/mcp",
  ])("refuses the literal %s", async (url) => {
    await refused(createGuardedFetch()(url), "private-address");
  });
});

describe("pinnedLookup", () => {
  it("answers with the checked address in both shapes Node asks for", () => {
    const lookup = pinnedLookup("93.184.216.34", 4);

    let many: unknown;
    lookup("anything.example", { all: true }, (err, addresses) => {
      expect(err).toBeNull();
      many = addresses;
    });
    expect(many).toEqual([{ address: "93.184.216.34", family: 4 }]);

    let one: unknown[] = [];
    lookup("anything.example", {}, (err, address, family) => {
      expect(err).toBeNull();
      one = [address, family];
    });
    expect(one).toEqual(["93.184.216.34", 4]);
  });
});

describe("against a live server, through the exemption", () => {
  let server: Server;
  let origin: string;
  const hits: string[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      hits.push(req.url ?? "");
      switch (req.url) {
        case "/ok":
          res.writeHead(200, { "content-type": "application/json" });
          res.end('{"ok":true}');
          return;
        case "/redirect":
          res.writeHead(302, { location: `${origin}/target` });
          res.end();
          return;
        case "/big": {
          // Chunked, with no content-length, so only the streaming cap can stop it.
          res.writeHead(200, { "content-type": "application/json" });
          const chunk = Buffer.alloc(64 * 1024, 97);
          let sent = 0;
          const pump = () => {
            while (sent < 8) {
              sent++;
              if (!res.write(chunk)) {
                res.once("drain", pump);
                return;
              }
            }
            res.end();
          };
          pump();
          return;
        }
        case "/slow":
          res.writeHead(200, { "content-type": "application/json" });
          res.write("{");
          setTimeout(() => res.end("}"), 2_000).unref();
          return;
        default:
          res.writeHead(404);
          res.end();
      }
    });
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  });

  it("exempts exactly the configured origin", async () => {
    await refused(createGuardedFetch()(`${origin}/ok`), "https-only");

    const res = await createGuardedFetch({ exemptOrigin: origin })(`${origin}/ok`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("blocks a redirect without requesting its target", async () => {
    const guarded = createGuardedFetch({ exemptOrigin: origin });
    await refused(guarded(`${origin}/redirect`), "redirect");
    expect(hits).not.toContain("/target");
  });

  it("aborts a body that streams past the cap", async () => {
    const guarded = createGuardedFetch({
      exemptOrigin: origin,
      maxResponseBytes: 100 * 1024,
    });
    const res = await guarded(`${origin}/big`);
    await expect(res.text()).rejects.toThrow();
  });

  it("times out a body that stalls, well before the server would finish", async () => {
    const guarded = createGuardedFetch({
      exemptOrigin: origin,
      requestTimeoutMs: 200,
    });
    const started = Date.now();
    const res = await guarded(`${origin}/slow`);
    await expect(res.text()).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  it("does not exempt the same host on a different port", async () => {
    const port = Number(new URL(origin).port) + 1;
    const guarded = createGuardedFetch({ exemptOrigin: origin });
    await refused(guarded(`http://127.0.0.1:${port}/ok`), "https-only");
  });

  it("does not exempt a suffix, a userinfo trick, or a path that names the origin", async () => {
    const asked: string[] = [];
    const guarded = createGuardedFetch({
      exemptOrigin: "https://api.example.com",
      resolve: async (host) => {
        asked.push(host);
        return [{ address: "10.0.0.9", family: 4 }];
      },
    });

    for (const url of [
      "https://api.example.com.evil.test/mcp",
      "https://api.example.com@evil.test/mcp",
      "https://evil.test/https://api.example.com/mcp",
    ]) {
      await refused(guarded(url), "private-address");
    }
    // Each was resolved, which is to say none was treated as exempt.
    expect(asked).toEqual(["api.example.com.evil.test", "evil.test", "evil.test"]);
  });
});
