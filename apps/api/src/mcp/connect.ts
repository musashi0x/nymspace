import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ErrorCode, McpError, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { DnsFailure, OutboundRefused, ResponseTooLarge, type GuardRule } from "./guard";

/**
 * Connect: a read-only MCP handshake against an endpoint somebody published.
 *
 * `initialize`, then `tools/list` up to a page cap, then close — and nothing
 * else, ever. A tool's name and description say nothing reliable about what
 * calling it does; a discovered server's `get_price` might place an order. So
 * this module has no code path that sends `tools/call`, and the test that
 * records every method it sends is what keeps that true (design D7).
 *
 * Every attempt ends in one outcome from a closed set (design D9). A failure is
 * a claim about the endpoint — where it failed and why — and never an empty
 * tool list, which would say "this server offers nothing" about a server that
 * never answered.
 */

export const OVERALL_TIMEOUT_MS = 10_000;
export const TOOLS_PAGE_CAP = 5;
export const DESCRIPTION_LIMIT = 280;
const NAME_LIMIT = 128;
const INPUT_LIMIT = 32;

export type EndpointSource = "ens" | "graph";
export type ConnectStage = "dns" | "connect" | "initialize" | "tools/list";

export interface ToolSummary {
  name: string;
  /** Truncated. Remote text, rendered as text and nothing else. */
  description: string | null;
  /** Top-level input property names only. A full schema is display data from a stranger. */
  inputs: string[];
}

/**
 * The server's reported name against the ENS name that published the endpoint.
 *
 * Always self-reported: the server can send any name it likes, so a match is a
 * consistency signal and never a verification. Absent when there is no ENS
 * name to compare against — a discovered agent that claims none.
 */
export interface IdentityCheck {
  expected: string;
  reported: string | null;
  result: "matches" | "differs" | "not_reported";
  selfReported: true;
}

interface Read {
  endpoint: string | null;
  endpointSource: EndpointSource;
  readAt: string;
}

export type HandshakeResult =
  | {
      status: "connected";
      protocolVersion: string | null;
      server: { name: string | null; version: string | null };
      identity?: IdentityCheck;
      claim?: ToolClaim;
      tools: ToolSummary[];
      toolsTruncated: boolean;
    }
  | { status: "blocked"; rule: GuardRule }
  | { status: "unreachable" | "timeout"; stage: ConnectStage; detail: string }
  | { status: "not_mcp"; httpStatus?: number; detail: string };

export type ConnectOutcome = Read & (HandshakeResult | { status: "no_endpoint" });

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function summarise(tool: Tool): ToolSummary {
  const properties = tool.inputSchema?.properties;
  return {
    name: truncate(String(tool.name), NAME_LIMIT),
    description: tool.description ? truncate(tool.description, DESCRIPTION_LIMIT) : null,
    inputs:
      properties && typeof properties === "object"
        ? Object.keys(properties).slice(0, INPUT_LIMIT).map((key) => truncate(key, NAME_LIMIT))
        : [],
  };
}

function compareIdentity(
  expected: string | undefined,
  reported: string | undefined,
): IdentityCheck | undefined {
  if (!expected) return undefined;
  if (!reported) {
    return { expected, reported: null, result: "not_reported", selfReported: true };
  }
  return {
    expected,
    reported,
    result: reported.toLowerCase() === expected.toLowerCase() ? "matches" : "differs",
    selfReported: true,
  };
}

/**
 * What a registration claims its server offers, against what `tools/list`
 * returned (design D11).
 *
 * Both directions, and neither list replaces the other: a claimed tool that is
 * not served and a served tool nobody claimed are both facts about the agent.
 * A truncated listing cannot prove a tool is missing, so `missing` is withheld
 * rather than computed from half a list.
 */
export interface ToolClaim {
  claimed: string[];
  /** Claimed but not served. Absent when the listing was truncated. */
  missing?: string[];
  /** Served but not claimed. */
  unclaimed: string[];
}

const CLAIM_LIMIT = 64;

function compareClaim(
  claimed: readonly string[],
  served: readonly string[],
  truncated: boolean,
): ToolClaim {
  // Both lists are remote text — the claim from a registration, the listing
  // from a server — so both are bounded before they leave this function.
  const bound = (names: Iterable<string>) =>
    [...names].slice(0, CLAIM_LIMIT).map((name) => truncate(name, NAME_LIMIT));
  const servedSet = new Set(served);
  const claimedSet = new Set(claimed);
  return {
    claimed: bound(claimedSet),
    ...(truncated
      ? {}
      : { missing: bound([...claimedSet].filter((name) => !servedSet.has(name))) }),
    unclaimed: bound([...servedSet].filter((name) => !claimedSet.has(name))),
  };
}

/** The error and everything it wraps, outermost first. */
function chain(error: unknown): unknown[] {
  const seen: unknown[] = [];
  let current: unknown = error;
  while (current && !seen.includes(current) && seen.length < 8) {
    seen.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  return seen;
}

function messageOf(error: unknown): string {
  return truncate(error instanceof Error ? error.message : String(error), DESCRIPTION_LIMIT);
}

/** Network-level failure codes: the request never got an HTTP answer. */
const CONNECTION_CODES = /^(E[A-Z]+|UND_ERR_[A-Z_]+|CERT_[A-Z_]+|ERR_TLS_[A-Z_]+|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_[A-Z_]+)$/;

/**
 * Which outcome a failure is, and at which stage.
 *
 * The guard's own refusals are checked first, because they say nothing was
 * sent. Then time, then transport, and last `not_mcp`: something answered,
 * and what it answered was not an MCP handshake the client could read.
 */
function classify(error: unknown, stage: ConnectStage): HandshakeResult {
  const causes = chain(error);
  const detail = messageOf(error);

  const refused = causes.find((c): c is OutboundRefused => c instanceof OutboundRefused);
  if (refused) return { status: "blocked", rule: refused.rule };

  const dns = causes.find((c): c is DnsFailure => c instanceof DnsFailure);
  if (dns) return { status: "unreachable", stage: "dns", detail: messageOf(dns) };

  const tooLarge = causes.find((c): c is ResponseTooLarge => c instanceof ResponseTooLarge);
  if (tooLarge) return { status: "not_mcp", detail: tooLarge.message };

  const timedOut = causes.some(
    (c) =>
      (c instanceof Error && (c.name === "TimeoutError" || c.name === "AbortError")) ||
      (c instanceof McpError && c.code === ErrorCode.RequestTimeout),
  );
  if (timedOut) return { status: "timeout", stage, detail };

  const http = causes.find((c): c is StreamableHTTPError => c instanceof StreamableHTTPError);
  if (http) {
    return {
      status: "not_mcp",
      ...(http.code !== undefined && { httpStatus: http.code }),
      detail,
    };
  }

  const connection = causes.find(
    (c) => typeof (c as { code?: unknown })?.code === "string" &&
      CONNECTION_CODES.test((c as { code: string }).code),
  );
  if (connection) {
    return { status: "unreachable", stage: "connect", detail: messageOf(connection) };
  }

  return { status: "not_mcp", detail };
}

export interface HandshakeOptions {
  /** The guarded fetch. Required, so no call site can fall back to global `fetch`. */
  fetch: FetchLike;
  /** The ENS name that published the endpoint, for the identity comparison. */
  expectedName?: string;
  /** The tools a registration claims, for a discovered agent. Empty or absent is no claim. */
  claimedTools?: readonly string[];
  overallTimeoutMs?: number;
  pageCap?: number;
}

export async function handshake(
  endpoint: string,
  options: HandshakeOptions,
): Promise<HandshakeResult> {
  const overall = AbortSignal.timeout(options.overallTimeoutMs ?? OVERALL_TIMEOUT_MS);
  const pageCap = options.pageCap ?? TOOLS_PAGE_CAP;

  // Every request the transport makes carries the overall deadline as well as
  // whatever signal the SDK attaches, and goes through the injected fetch.
  const fetchWithDeadline: FetchLike = (url, init) =>
    options.fetch(url, {
      ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, overall]) : overall,
    });

  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    fetch: fetchWithDeadline,
  });
  const client = new Client({ name: "nymspace-connect", version: "0.1.0" });

  let stage: ConnectStage = "initialize";
  try {
    await client.connect(transport, { signal: overall });

    stage = "tools/list";
    const tools: Tool[] = [];
    let cursor: string | undefined;
    let pages = 0;
    let truncated = false;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined, { signal: overall });
      tools.push(...page.tools);
      cursor = page.nextCursor;
      pages++;
      if (cursor && pages >= pageCap) {
        truncated = true;
        break;
      }
    } while (cursor);

    const server = client.getServerVersion();
    const identity = compareIdentity(options.expectedName, server?.name);
    const claim = options.claimedTools?.length
      ? compareClaim(
          options.claimedTools,
          tools.map((tool) => String(tool.name)),
          truncated,
        )
      : undefined;
    return {
      status: "connected",
      protocolVersion: transport.protocolVersion ?? null,
      server: {
        name: server?.name ? truncate(server.name, NAME_LIMIT) : null,
        version: server?.version ? truncate(server.version, NAME_LIMIT) : null,
      },
      ...(identity && { identity }),
      ...(claim && { claim }),
      tools: tools.map(summarise),
      toolsTruncated: truncated,
    };
  } catch (error) {
    return classify(error, stage);
  } finally {
    await client.close().catch(() => undefined);
  }
}

//////////////////////////////////////////////////////////////////////////////
// Throttle — one in flight per target, and a cooldown after it
//////////////////////////////////////////////////////////////////////////////

export const COOLDOWN_MS = 10_000;

interface Attempt {
  outcome: Promise<ConnectOutcome>;
  settledAt?: number;
}

const attempts = new Map<string, Attempt>();

/**
 * Returns the in-flight or most recent outcome for a target instead of
 * starting another.
 *
 * Keyed by target — `fleet:<agentId>`, `graph:<key>` — rather than by endpoint,
 * so a repeated connect costs no outbound request of any kind: not to the
 * endpoint, and not to ENS or the Graph gateway to resolve it again. The
 * outcome keeps its original `readAt`, which is when it was true.
 *
 * A thrown failure — this API's own, not the endpoint's — is not kept, so the
 * next request tries again rather than repeating an outage for ten seconds.
 */
export function throttled(
  key: string,
  run: () => Promise<ConnectOutcome>,
  now: number = Date.now(),
): Promise<ConnectOutcome> {
  for (const [k, attempt] of attempts) {
    if (attempt.settledAt !== undefined && now - attempt.settledAt >= COOLDOWN_MS) {
      attempts.delete(k);
    }
  }

  const existing = attempts.get(key);
  if (existing) return existing.outcome;

  const attempt: Attempt = { outcome: run() };
  attempts.set(key, attempt);
  attempt.outcome.then(
    () => {
      attempt.settledAt = Date.now();
    },
    () => {
      attempts.delete(key);
    },
  );
  return attempt.outcome;
}

/** Tests, so one case's cooldown cannot answer the next. */
export function resetConnectThrottle(): void {
  attempts.clear();
}
