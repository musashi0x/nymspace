import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Hono } from "hono";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import { FLEET } from "@nymspace/core";
import { createApp, DEPENDENT_ROUTES, errorHandler } from "./app";
import type { ApiConfig } from "./config";
import { withDeps, type Deps, type DepsEnv } from "./deps";
import { agentMcp } from "./routes/agent-mcp";

/**
 * The fleet's MCP servers, driven through `app.fetch` by the SDK's own client.
 *
 * The client is the real one, not a hand-built JSON-RPC body, so these tests
 * fail the way an MCP client in the wild would fail: on a protocol version the
 * server will not negotiate, a missing capability, or a transport the client
 * cannot read. No port is bound.
 */

const config: ApiConfig = {
  port: 0,
  allowedOrigins: ["http://localhost:3111"],
  agentParentName: "nymspace.eth",
};

const app = createApp(config);

/**
 * Throws on any read, so a route that so much as looks at a dependency fails.
 * Setting it on a context does not read it, which is what lets the guard in
 * `agent-mcp.ts` be the thing that notices.
 */
const trap = new Proxy(
  {},
  {
    get(_, key) {
      throw new Error(`deps.${String(key)} was read`);
    },
  },
) as Deps;

type Fetcher = { fetch: (request: Request) => Response | Promise<Response> };

async function connect(target: Fetcher, url: string) {
  const client = new Client({ name: "agent-mcp.test", version: "0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      fetch: async (input, init) => target.fetch(new Request(input, init)),
    }),
  );
  return client;
}

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "raw", version: "0" },
  },
};

function post(target: Fetcher, path: string, body: unknown, headers: Record<string, string> = {}) {
  return target.fetch(
    new Request(`http://api.test${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );
}

const EXPECTED_TOOLS: Record<string, string[]> = {
  research: ["describe_agent", "list_fleet"],
  trader: ["describe_agent"],
  deploy: ["describe_agent"],
};

describe("each fleet agent serves MCP", () => {
  for (const agent of FLEET) {
    it(`${agent.label} completes the handshake and names itself by its ENS name`, async () => {
      const client = await connect(app, `http://api.test/mcp/${agent.label}`);

      expect(client.getServerVersion()?.name).toBe(`${agent.label}.nymspace.eth`);
      expect(client.getServerCapabilities()?.tools).toBeDefined();

      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual(EXPECTED_TOOLS[agent.label]);
      for (const tool of tools) {
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema.type).toBe("object");
        expect(tool.annotations?.readOnlyHint).toBe(true);
      }

      await client.close();
    });
  }

  it("serves the same endpoint with a query string on it", async () => {
    const client = await connect(app, "http://api.test/mcp/research?proof=1788962862035");
    expect(client.getServerVersion()?.name).toBe("research.nymspace.eth");
    expect((await client.listTools()).tools).toHaveLength(2);
    await client.close();
  });

  it("answers describe_agent from public facts and says what it cannot do", async () => {
    const client = await connect(app, "http://api.test/mcp/trader");
    const result = await client.callTool({ name: "describe_agent", arguments: {} });
    const [first] = result.content as { type: string; text: string }[];
    const body = JSON.parse(first!.text);

    expect(body).toMatchObject({
      ensName: "trader.nymspace.eth",
      name: "Trader",
      access: "read-only",
    });
    expect(body.note).toMatch(/cannot move funds/);
    // Nothing shaped like a key or a hash, which is all a secret could be here.
    expect(first!.text).not.toMatch(/0x[0-9a-f]{64}/i);
    await client.close();
  });

  it("needs no session: each request stands alone", async () => {
    for (let i = 0; i < 2; i++) {
      const res = await post(
        app,
        "/mcp/research",
        { jsonrpc: "2.0", id: i, method: "tools/list", params: {} },
        { "mcp-protocol-version": "2025-11-25" },
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("mcp-session-id")).toBeNull();
      const body = await res.json();
      expect(body.result.tools).toHaveLength(2);
    }
  });

  it("answers 404 in the standard shape for a label that is not an agent", async () => {
    const res = await post(app, "/mcp/nobody", initialize);
    expect(res.status).toBe(404);
    // `toMatchObject`, so a field the shared error shape gains later — a
    // request id — does not read as this route breaking.
    expect(await res.json()).toMatchObject({ error: "not found", path: "/mcp/nobody" });
  });

  it("answers 503 when no parent name is configured, and nothing else breaks", async () => {
    const bare = createApp({ port: 0, allowedOrigins: [] });
    expect((await post(bare, "/mcp/research", initialize)).status).toBe(503);
    expect((await bare.fetch(new Request("http://api.test/health"))).status).toBe(200);
  });
});

describe("agent MCP routes cannot reach authority", () => {
  it("is not among the routes that receive dependencies", () => {
    for (const path of DEPENDENT_ROUTES) {
      expect(path.startsWith("/mcp")).toBe(false);
      expect("/mcp/research".startsWith(path)).toBe(false);
    }
  });

  it("serves the handshake on an app whose dependencies throw on any read", async () => {
    const guarded = createApp(config, trap);
    const client = await connect(guarded, "http://api.test/mcp/research");
    expect((await client.listTools()).tools).toHaveLength(2);
    await client.close();
  });

  it("refuses to serve at all if dependencies are ever mounted on it", async () => {
    const wrong = new Hono<DepsEnv>();
    wrong.use("*", withDeps(trap));
    wrong.route("/mcp", agentMcp("nymspace.eth"));
    wrong.onError(errorHandler);

    expect((await post(wrong, "/mcp/research", initialize)).status).toBe(500);
  });

  it("imports nothing from the dependency container", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const file of ["mcp/servers.ts", "routes/agent-mcp.ts"]) {
      const source = readFileSync(resolve(here, file), "utf8");
      expect(source, file).not.toMatch(/from\s+["'](?:\.\.?\/)+deps["']/);
    }
  });
});

describe("CORS on protocol routes", () => {
  it("serves a client that sends no Origin header", async () => {
    const res = await post(app, "/mcp/research", initialize);
    expect(res.status).toBe(200);
    expect((await res.json()).result.serverInfo.name).toBe("research.nymspace.eth");
  });

  it("lets a browser-based MCP client from any origin negotiate a version", async () => {
    const res = await app.fetch(
      new Request("http://api.test/mcp/research", {
        method: "OPTIONS",
        headers: {
          Origin: "https://inspector.example",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type,mcp-protocol-version",
        },
      }),
    );
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-headers")).toMatch(/mcp-protocol-version/);
  });

  it("keeps the allowlist on product routes", async () => {
    const res = await app.fetch(
      new Request("http://api.test/v1/agents", {
        method: "OPTIONS",
        headers: {
          Origin: "https://inspector.example",
          "Access-Control-Request-Method": "GET",
        },
      }),
    );
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
