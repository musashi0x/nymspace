import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { serve, type ServerType } from "@hono/node-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import type { ApiConfig } from "../config";
import type { Deps } from "../deps";
import {
  handshake,
  resetConnectThrottle,
  throttled,
  type ConnectOutcome,
} from "./connect";
import { createGuardedFetch } from "./guard";

/**
 * Connect, against real sockets.
 *
 * Two servers. One is this API itself, serving the fleet's agent MCP servers,
 * and every JSON-RPC method it receives is recorded — which is how "no
 * `tools/call`, ever" becomes an assertion rather than a promise. The other is
 * a deliberately bad server: it paginates forever, answers HTML, answers 404,
 * redirects, and sleeps. Both are reached through the guard's exemption, the
 * only way an `http://127.0.0.1` server gets through at all.
 */

const methods: string[] = [];
let agentServer: ServerType;
let agentOrigin: string;
let badServer: Server;
let badOrigin: string;

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function json(res: import("node:http").ServerResponse, value: unknown) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

beforeAll(async () => {
  const app = createApp({
    port: 0,
    allowedOrigins: [],
    agentParentName: "nymspace.eth",
  });

  agentServer = serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      if (request.method === "POST") {
        const payload = await request.clone().json().catch(() => null);
        for (const message of [payload].flat()) {
          if (message && typeof message.method === "string") methods.push(message.method);
        }
      }
      return app.fetch(request);
    },
  });
  await new Promise<void>((ready) => agentServer.once("listening", () => ready()));
  agentOrigin = `http://127.0.0.1:${(agentServer.address() as AddressInfo).port}`;

  badServer = createServer(async (req, res) => {
    if (req.url === "/html") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><body>not an MCP server</body></html>");
      return;
    }
    if (req.url === "/missing") {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("no");
      return;
    }
    if (req.url === "/redirect") {
      res.writeHead(302, { location: `${badOrigin}/elsewhere` });
      res.end();
      return;
    }
    if (req.url === "/sleepy") return; // never answers

    if (req.url === "/paged") {
      if (req.method !== "POST") {
        res.writeHead(405);
        res.end();
        return;
      }
      const message = JSON.parse(await body(req));
      if (message.method === "initialize") {
        json(res, {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: message.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "endless.example.eth", version: "1" },
          },
        });
        return;
      }
      if (message.method === "tools/list") {
        const page = Number(message.params?.cursor ?? 0);
        json(res, {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            tools: [
              {
                name: `tool_${page}`,
                description: "x".repeat(1_000),
                inputSchema: { type: "object", properties: { a: {}, b: {} } },
              },
            ],
            nextCursor: String(page + 1),
          },
        });
        return;
      }
      res.writeHead(202);
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((ready) => badServer.listen(0, "127.0.0.1", ready));
  badOrigin = `http://127.0.0.1:${(badServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  badServer.closeAllConnections();
  await new Promise<void>((done) => badServer.close(() => done()));
  await new Promise<void>((done) => agentServer.close(() => done()));
});

beforeEach(() => {
  methods.length = 0;
  resetConnectThrottle();
});

const agentFetch = () => createGuardedFetch({ exemptOrigin: agentOrigin });
const badFetch = () => createGuardedFetch({ exemptOrigin: badOrigin });

describe("a read-only handshake", () => {
  it("connects to a fleet agent and reports what it offers", async () => {
    const result = await handshake(`${agentOrigin}/mcp/research`, {
      fetch: agentFetch(),
      expectedName: "research.nymspace.eth",
    });

    expect(result).toMatchObject({
      status: "connected",
      server: { name: "research.nymspace.eth" },
      identity: { result: "matches", selfReported: true },
      toolsTruncated: false,
    });
    if (result.status !== "connected") throw new Error("unreachable");
    expect(result.protocolVersion).toBeTruthy();
    expect(result.tools.map((t) => t.name).sort()).toEqual(["describe_agent", "list_fleet"]);
  });

  it("never sends tools/call, whatever the server offers", async () => {
    await handshake(`${agentOrigin}/mcp/research`, { fetch: agentFetch() });
    expect(methods).toContain("initialize");
    expect(methods).toContain("tools/list");
    expect(methods).not.toContain("tools/call");
    expect(methods.every((m) => ["initialize", "notifications/initialized", "tools/list"].includes(m))).toBe(true);
  });

  it("reports a name that differs from the publishing ENS name as differing", async () => {
    const result = await handshake(`${agentOrigin}/mcp/trader`, {
      fetch: agentFetch(),
      expectedName: "research.nymspace.eth",
    });
    expect(result).toMatchObject({ status: "connected", identity: { result: "differs" } });
  });

  it("omits the identity check when there is no ENS name to compare with", async () => {
    const result = await handshake(`${agentOrigin}/mcp/deploy`, { fetch: agentFetch() });
    expect(result.status).toBe("connected");
    expect(result).not.toHaveProperty("identity");
  });

  it("stops listing at the page cap and says so", async () => {
    const result = await handshake(`${badOrigin}/paged`, { fetch: badFetch(), pageCap: 3 });
    expect(result).toMatchObject({ status: "connected", toolsTruncated: true });
    if (result.status !== "connected") throw new Error("unreachable");
    expect(result.tools).toHaveLength(3);
  });

  it("bounds remote text: descriptions truncated, schemas reduced to property names", async () => {
    const result = await handshake(`${badOrigin}/paged`, { fetch: badFetch(), pageCap: 1 });
    if (result.status !== "connected") throw new Error(`expected connected, got ${result.status}`);
    const [tool] = result.tools;
    expect(tool!.description!.length).toBeLessThanOrEqual(280);
    expect(tool!.inputs).toEqual(["a", "b"]);
  });
});

describe("every failure is a typed claim about the endpoint", () => {
  it("is blocked when the guard refuses, and says which rule", async () => {
    const result = await handshake(`${badOrigin}/paged`, { fetch: createGuardedFetch() });
    expect(result).toMatchObject({ status: "blocked", rule: "https-only" });
  });

  it("is blocked when the endpoint redirects", async () => {
    const result = await handshake(`${badOrigin}/redirect`, { fetch: badFetch() });
    expect(result).toMatchObject({ status: "blocked", rule: "redirect" });
  });

  it("is unreachable at dns when the name does not resolve", async () => {
    const fetch = createGuardedFetch({
      resolve: async () => {
        throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
      },
    });
    const result = await handshake("https://nowhere.invalid/mcp", { fetch });
    expect(result).toMatchObject({ status: "unreachable", stage: "dns" });
  });

  it("is unreachable at connect when nothing listens", async () => {
    const closed = `http://127.0.0.1:${Number(new URL(badOrigin).port) + 7}`;
    const result = await handshake(`${closed}/mcp`, {
      fetch: createGuardedFetch({ exemptOrigin: closed }),
    });
    expect(result).toMatchObject({ status: "unreachable", stage: "connect" });
  });

  it("is not_mcp when the endpoint answers HTML", async () => {
    const result = await handshake(`${badOrigin}/html`, { fetch: badFetch() });
    expect(result.status).toBe("not_mcp");
  });

  it("is not_mcp with the HTTP status when the endpoint answers 404", async () => {
    const result = await handshake(`${badOrigin}/missing`, { fetch: badFetch() });
    expect(result).toMatchObject({ status: "not_mcp", httpStatus: 404 });
  });

  it("is a timeout, at the stage it happened, when the endpoint never answers", async () => {
    const result = await handshake(`${badOrigin}/sleepy`, {
      fetch: badFetch(),
      overallTimeoutMs: 300,
    });
    expect(result).toMatchObject({ status: "timeout", stage: "initialize" });
  });
});

describe("the transport uses the injected fetch", () => {
  it("sends every request through it, and never falls back to global fetch", async () => {
    const seen: string[] = [];
    const guarded = agentFetch();
    const result = await handshake(`${agentOrigin}/mcp/research`, {
      fetch: async (url, init) => {
        seen.push(String(url));
        return guarded(url, init);
      },
    });
    expect(result.status).toBe("connected");
    expect(seen.length).toBeGreaterThanOrEqual(2);
  });

  it("reports what the injected fetch did, even when it refuses everything", async () => {
    const result = await handshake(`${agentOrigin}/mcp/research`, {
      fetch: async () => {
        throw Object.assign(new Error("sentinel"), { code: "ECONNREFUSED" });
      },
    });
    // Had the transport used global fetch, this would have connected.
    expect(result).toMatchObject({ status: "unreachable", stage: "connect" });
  });
});

describe("throttle", () => {
  const outcome = (n: number): ConnectOutcome => ({
    status: "no_endpoint",
    endpoint: null,
    endpointSource: "ens",
    readAt: `t${n}`,
  });

  it("shares one in-flight attempt per target", async () => {
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const run = async () => {
      runs++;
      await gate;
      return outcome(runs);
    };
    const a = throttled("fleet:x", run);
    const b = throttled("fleet:x", run);
    release();
    expect(await a).toBe(await b);
    expect(runs).toBe(1);
  });

  it("answers from the last attempt inside the cooldown, and tries again after it", async () => {
    let runs = 0;
    const run = async () => outcome(++runs);
    await throttled("fleet:y", run);
    expect((await throttled("fleet:y", run)).readAt).toBe("t1");
    expect(await throttled("fleet:y", run, Date.now() + 60_000)).toMatchObject({ readAt: "t2" });
  });

  it("does not keep a failure of this API", async () => {
    let runs = 0;
    await expect(
      throttled("fleet:z", async () => {
        runs++;
        throw new Error("store down");
      }),
    ).rejects.toThrow("store down");
    await throttled("fleet:z", async () => outcome(++runs));
    expect(runs).toBe(2);
  });
});

describe("POST /v1/mcp/connect", () => {
  const agent = {
    id: "agent-research",
    slug: "research",
    ensName: "research.nymspace.eth",
    controllerAddress: "0xDEA25D2537cE06cE1073dd9621C70056CBDC3aEB",
  };

  const events: Record<string, unknown>[] = [];
  beforeEach(() => {
    events.length = 0;
  });

  /** Every app here records into `events`, whatever else its store fakes. */
  function appWith(deps: Partial<Deps>, extra: Partial<ApiConfig> = {}) {
    const store = {
      recordEvent: async (event: Record<string, unknown>) => {
        events.push(event);
        return event;
      },
      ...(deps.store as object | undefined),
    };
    return createApp(
      { port: 0, allowedOrigins: [], ...extra },
      { ...deps, store } as unknown as Deps,
    );
  }

  /*
    Carries the write token. A connect dials somebody else's server and records
    an activity row, so `write-gate.ts` puts it behind the same credential as
    the routes that spend gas — the cost here is reputational rather than
    financial, but an open endpoint that makes this deployment dial arbitrary
    published endpoints on request is the same shape of hole.
  */
  const WRITE_TOKEN = "test-write-token";

  beforeAll(() => {
    process.env["CONSOLE_MCP_TOKEN"] = WRITE_TOKEN;
  });
  afterAll(() => {
    delete process.env["CONSOLE_MCP_TOKEN"];
  });

  const post = (app: ReturnType<typeof createApp>, body: unknown) =>
    app.fetch(
      new Request("http://api.test/v1/mcp/connect", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${WRITE_TOKEN}`,
        },
        body: JSON.stringify(body),
      }),
    );

  it("rejects a URL, in any position, before resolving anything", async () => {
    let touched = false;
    const app = appWith({
      store: {
        getAgent: async () => {
          touched = true;
          return agent;
        },
      } as unknown as Deps["store"],
    });

    for (const body of [
      { target: { kind: "fleet", agentId: "agent-research" }, url: "https://x" },
      { target: { kind: "fleet", agentId: "agent-research", url: "https://x" } },
      { target: { kind: "url", url: "https://x" } },
      { target: { kind: "graph", graphAgentKey: "https://x" } },
    ]) {
      expect((await post(app, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(touched).toBe(false);
  });

  it("answers no_endpoint, and dials nothing, when the record is empty", async () => {
    const app = appWith({
      store: { getAgent: async () => agent } as unknown as Deps["store"],
      ens: { readText: async () => "" } as unknown as Deps["ens"],
    });
    const res = await post(app, { target: { kind: "fleet", agentId: "agent-research" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "no_endpoint",
      endpoint: null,
      endpointSource: "ens",
    });
    expect(methods).toHaveLength(0);
    // Logged as an attempt that reached nothing; the evidence says why.
    expect(events).toMatchObject([
      {
        source: "mcp",
        type: "mcp.connect.failed",
        status: "failed",
        agentId: "agent-research",
        evidence: { source: "mcp", outcome: "no_endpoint", endpoint: null, endpointSource: "ens" },
      },
    ]);
  });

  it("resolves a fleet agent through its live ENS record and connects", async () => {
    const app = appWith(
      {
        store: { getAgent: async () => agent } as unknown as Deps["store"],
        ens: {
          readText: async () => `${agentOrigin}/mcp/research?proof=1`,
        } as unknown as Deps["ens"],
      },
      { agentMcpBaseUrl: agentOrigin },
    );
    const res = await post(app, { target: { kind: "fleet", agentId: "agent-research" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "connected",
      endpointSource: "ens",
      endpoint: `${agentOrigin}/mcp/research?proof=1`,
      identity: { result: "matches" },
    });
    expect(events).toMatchObject([
      {
        type: "mcp.connect.succeeded",
        status: "success",
        evidence: { outcome: "connected", endpointSource: "ens" },
      },
    ]);
  });

  it("resolves a discovered agent through Agent0 and reports a failure as a 200", async () => {
    const app = appWith({
      graph: {
        agentProfile: async () => ({
          graphAgentKey: "11155111:7",
          mcpEndpoint: "http://localhost:8080/mcp",
        }),
      } as unknown as Deps["graph"],
    });
    const res = await post(app, { target: { kind: "graph", graphAgentKey: "11155111:7" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "blocked",
      rule: "https-only",
      endpointSource: "graph",
      endpoint: "http://localhost:8080/mcp",
    });
    // The guard refusing is the control working, recorded like any denial.
    expect(events).toMatchObject([
      {
        type: "mcp.connect.blocked",
        status: "denied",
        evidence: { outcome: "blocked", endpointSource: "graph" },
        metadata: { rule: "https-only" },
      },
    ]);
    expect(events[0]).not.toHaveProperty("agentId");
  });

  it("answers 404 for an Agent0 key that names no agent", async () => {
    const app = appWith({
      graph: { agentProfile: async () => undefined } as unknown as Deps["graph"],
    });
    const res = await post(app, { target: { kind: "graph", graphAgentKey: "11155111:404" } });
    expect(res.status).toBe(404);
  });

  it("compares a discovered agent's claimed tools with the ones it serves", async () => {
    const app = appWith(
      {
        graph: {
          agentProfile: async () => ({
            graphAgentKey: "84532:9",
            mcpEndpoint: `${agentOrigin}/mcp/research`,
            claimedEnsName: "research.nymspace.eth",
            mcpTools: ["describe_agent", "place_order"],
          }),
        } as unknown as Deps["graph"],
      },
      { agentMcpBaseUrl: agentOrigin },
    );
    const res = await post(app, { target: { kind: "graph", graphAgentKey: "84532:9" } });
    expect(await res.json()).toMatchObject({
      status: "connected",
      endpointSource: "graph",
      claim: {
        claimed: ["describe_agent", "place_order"],
        missing: ["place_order"],
        unclaimed: ["list_fleet"],
      },
    });
  });

  it("retains a failed attempt, and logs a repeat from the cooldown not at all", async () => {
    const app = appWith(
      {
        store: { getAgent: async () => agent } as unknown as Deps["store"],
        ens: { readText: async () => `${badOrigin}/missing` } as unknown as Deps["ens"],
      },
      { agentMcpBaseUrl: badOrigin },
    );
    const target = { target: { kind: "fleet", agentId: "agent-research" } };

    const first = await (await post(app, target)).json();
    const second = await (await post(app, target)).json();

    expect(first).toMatchObject({ status: "not_mcp", httpStatus: 404 });
    expect(second).toEqual(first);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "mcp.connect.failed",
      status: "failed",
      evidence: { outcome: "not_mcp" },
      metadata: { httpStatus: 404 },
    });
  });
});

describe("claimed against served", () => {
  it("withholds missing when the listing was truncated", async () => {
    const result = await handshake(`${badOrigin}/paged`, {
      fetch: badFetch(),
      pageCap: 2,
      claimedTools: ["tool_0", "tool_99"],
    });
    expect(result).toMatchObject({
      status: "connected",
      toolsTruncated: true,
      claim: { claimed: ["tool_0", "tool_99"], unclaimed: ["tool_1"] },
    });
    if (result.status !== "connected") throw new Error("unreachable");
    // Half a list cannot prove tool_99 is not served.
    expect(result.claim).not.toHaveProperty("missing");
  });

  it("omits the comparison when nothing was claimed", async () => {
    const result = await handshake(`${agentOrigin}/mcp/research`, {
      fetch: agentFetch(),
      claimedTools: [],
    });
    expect(result.status).toBe("connected");
    expect(result).not.toHaveProperty("claim");
  });
});
