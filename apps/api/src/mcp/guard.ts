import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";

/**
 * The only way this process requests a URL somebody else published.
 *
 * MCP endpoints come from ENS records a controller can write and from ERC 8004
 * registrations anyone can file, and this API has no caller authentication. A
 * connect that fetched whatever URL it found would be an open door into the
 * network this process runs on — the cloud metadata service first among it.
 * So every outbound request passes here, and each rule refuses before a byte
 * is sent to the target (design D8):
 *
 *   1. `https:` only;
 *   2. the hostname is resolved first, and refused if *any* address is
 *      internal — then the connection is pinned to the checked address, so a
 *      second resolution cannot rebind it somewhere the check never saw;
 *   3. redirects are not followed: a 3xx is a new, unchecked target;
 *   4. each request times out, alongside whatever overall signal the caller
 *      passes;
 *   5. the body is capped while it streams, never after it has been buffered.
 *
 * One origin is exempt from rules 1 and 2: `AGENT_MCP_BASE_URL`'s, exactly,
 * which is how a local API reaches its own agent servers on
 * `http://localhost`. Rules 3 to 5 still apply to it.
 */

export const REQUEST_TIMEOUT_MS = 5_000;
export const MAX_RESPONSE_BYTES = 256 * 1024;

export type GuardRule = "https-only" | "private-address" | "redirect";

/** A request the guard refused. Nothing was sent to the target. */
export class OutboundRefused extends Error {
  readonly rule: GuardRule;

  constructor(rule: GuardRule, detail: string) {
    super(`${rule}: ${detail}`);
    this.name = "OutboundRefused";
    this.rule = rule;
  }
}

/** The body grew past the cap while streaming, and was aborted there. */
export class ResponseTooLarge extends Error {
  readonly limit: number;

  constructor(limit: number) {
    super(`response exceeded ${limit} bytes`);
    this.name = "ResponseTooLarge";
    this.limit = limit;
  }
}

/** The hostname did not resolve. Distinct so a caller can name the stage. */
export class DnsFailure extends Error {
  readonly host: string;

  constructor(host: string, cause: unknown) {
    super(`${host} did not resolve`, { cause });
    this.name = "DnsFailure";
    this.host = host;
  }
}

/**
 * Every range a published endpoint must not reach.
 *
 * `BlockList` matches IPv4-mapped IPv6 (`::ffff:10.0.0.1`, and its hex form)
 * against the IPv4 rules, so one list covers an address written either way.
 */
const BLOCKED = (() => {
  const list = new BlockList();
  const v4: [string, number][] = [
    ["0.0.0.0", 8], // unspecified, "this network"
    ["10.0.0.0", 8], // RFC 1918
    ["100.64.0.0", 10], // CGNAT, RFC 6598
    ["127.0.0.0", 8], // loopback
    ["169.254.0.0", 16], // link-local, including the 169.254.169.254 metadata service
    ["172.16.0.0", 12], // RFC 1918
    ["192.168.0.0", 16], // RFC 1918
    ["224.0.0.0", 4], // multicast
    ["240.0.0.0", 4], // reserved, including broadcast
  ];
  const v6: [string, number][] = [
    ["::", 128], // unspecified
    ["::1", 128], // loopback
    ["fc00::", 7], // unique local, RFC 4193
    ["fe80::", 10], // link-local
    ["ff00::", 8], // multicast
  ];
  for (const [net, prefix] of v4) list.addSubnet(net, prefix, "ipv4");
  for (const [net, prefix] of v6) list.addSubnet(net, prefix, "ipv6");
  return list;
})();

/** True for anything that is not a public unicast address, including non-addresses. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  return BLOCKED.check(address, family === 4 ? "ipv4" : "ipv6");
}

export type ResolveAll = (
  host: string,
) => Promise<{ address: string; family: number }[]>;

const resolveAll: ResolveAll = (host) =>
  dnsLookup(host, { all: true, verbatim: true });

/**
 * A `lookup` that always answers with the address the guard already checked.
 *
 * Node calls it two ways. With `all: true` — when it races address families,
 * which Node 22 does by default — it expects an array; without, one address
 * and its family. Answering the wrong shape fails the connection with an error
 * that names neither this function nor the guard.
 */
export function pinnedLookup(address: string, family: number): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

/** Errors the stream, which cancels the source, the moment the count passes the cap. */
function capAt(limit: number): TransformStream<Uint8Array, Uint8Array> {
  let seen = 0;
  return new TransformStream({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > limit) {
        controller.error(new ResponseTooLarge(limit));
        return;
      }
      controller.enqueue(chunk);
    },
  });
}

export interface GuardOptions {
  /** `AGENT_MCP_BASE_URL`. Its origin, exactly, skips rules 1 and 2. */
  exemptOrigin?: string;
  /** Injected by tests; the real one is `dns.lookup` with `all: true`. */
  resolve?: ResolveAll;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
}

export function createGuardedFetch(options: GuardOptions = {}): FetchLike {
  const exempt = options.exemptOrigin
    ? new URL(options.exemptOrigin).origin
    : undefined;
  const resolve = options.resolve ?? resolveAll;
  const timeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const maxBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;

  return async (input, init) => {
    const url = new URL(input);

    let dispatcher: Agent | undefined;
    if (url.origin !== exempt) {
      if (url.protocol !== "https:") {
        throw new OutboundRefused("https-only", `${url.origin} is not https`);
      }

      // `[::1]` arrives bracketed from the URL parser; the resolver wants it bare.
      const host = url.hostname.replace(/^\[|\]$/g, "");
      let addresses: Awaited<ReturnType<ResolveAll>>;
      try {
        addresses = await resolve(host);
      } catch (cause) {
        throw new DnsFailure(host, cause);
      }
      const [first] = addresses;
      if (!first) throw new DnsFailure(host, new Error("no addresses"));

      const internal = addresses.find((entry) => isBlockedAddress(entry.address));
      if (internal) {
        throw new OutboundRefused(
          "private-address",
          `${host} resolves to ${internal.address}`,
        );
      }

      dispatcher = new Agent({
        connect: { lookup: pinnedLookup(first.address, first.family) },
      });
    }

    const perRequest = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal
      ? AbortSignal.any([init.signal, perRequest])
      : perRequest;

    let res: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      res = await undiciFetch(url, {
        ...(init as UndiciRequestInit | undefined),
        redirect: "manual",
        signal,
        ...(dispatcher && { dispatcher }),
      });
    } catch (error) {
      void dispatcher?.close();
      throw error;
    }

    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel();
      void dispatcher?.close();
      const location = res.headers.get("location");
      throw new OutboundRefused(
        "redirect",
        `${url.origin} answered ${res.status}${location ? ` to ${location}` : ""}`,
      );
    }

    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await res.body?.cancel();
      void dispatcher?.close();
      throw new ResponseTooLarge(maxBytes);
    }

    // Graceful: resolves once this request's body has finished or been aborted.
    void dispatcher?.close();

    const body = res.body
      ? (res.body as unknown as ReadableStream<Uint8Array>).pipeThrough(capAt(maxBytes))
      : null;
    return new Response(body, {
      status: res.status,
      statusText: res.statusText,
      headers: Object.fromEntries(res.headers),
    });
  };
}
