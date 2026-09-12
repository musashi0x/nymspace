import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import type { Deps } from "./deps";

/**
 * The gate on everything that spends.
 *
 * `POST /v1/agents` was reachable by anyone who knew the URL, and a 400 from
 * the validator was the first thing that looked at a request — so a stranger
 * could register subnames under the organization's name until its gas ran out.
 * A regression here breaks nothing visible: the console keeps working through
 * its proxy, the tools keep working through the loopback, and the only symptom
 * is that the door is open again. So it is asserted directly.
 */

const config = { port: 0, allowedOrigins: [] };

const agent = {
  id: "agent-research",
  organizationId: "nymspace",
  slug: "research",
  ensName: "research.nymspace.eth",
  controllerAddress: "0xDEA25D2537cE06cE1073dd9621C70056CBDC3aEB",
  provisioning: {
    ens: "active",
    erc8004: "registered",
    ensip25: "verified",
    graph: "indexed",
    financial: "policy_configured",
  },
};

function app() {
  return createApp(config, {
    store: { listAgents: async () => [agent], getAgent: async () => agent },
    parentName: "nymspace.eth",
    config: { chainId: 11155111 },
  } as unknown as Deps);
}

function post(path: string, token?: string) {
  return new Request(`http://api.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: "{}",
  });
}

/* Cleared both ways: the "unconfigured" case asserts on absence, and a
   developer with the variable in their `.env` would otherwise inherit it. */
beforeEach(() => {
  delete process.env["CONSOLE_MCP_TOKEN"];
});
afterEach(() => {
  delete process.env["CONSOLE_MCP_TOKEN"];
});

/** Every route that costs the organization gas, a payment, or model credits. */
const SPENDS = [
  "/v1/agents",
  "/v1/agents/agent-research/permissions",
  "/v1/agents/agent-research/records",
  "/v1/agents/agent-research/payments",
  "/v1/agents/agent-research/payments/req-1/approve",
  "/v1/mcp/connect",
  "/v1/discover",
];

describe("the write gate", () => {
  it("refuses every spending route without a token", async () => {
    process.env["CONSOLE_MCP_TOKEN"] = "s3cret";
    const server = app();

    for (const path of SPENDS) {
      const res = await server.fetch(post(path));
      expect(res.status, path).toBe(401);
      expect(res.headers.get("www-authenticate"), path).toContain("Bearer");
    }
  });

  it("refuses a wrong token, including one sharing a prefix", async () => {
    process.env["CONSOLE_MCP_TOKEN"] = "s3cret";
    const server = app();

    for (const wrong of ["nope", "s3cre", "s3cret-longer", "S3CRET"]) {
      const res = await server.fetch(post("/v1/agents", wrong));
      expect(res.status, wrong).toBe(401);
    }
  });

  it("is unconfigured rather than open when no token is set", async () => {
    // The direction that matters: a deployment nobody configured refuses to
    // spend, instead of letting anyone spend.
    const res = await app().fetch(post("/v1/agents"));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("CONSOLE_MCP_TOKEN");
  });

  it("lets a valid token reach the handler", async () => {
    process.env["CONSOLE_MCP_TOKEN"] = "s3cret";
    // 400 from the validator, not 401 — the empty body got past the gate and
    // was refused on its own merits, which is how we know the gate opened.
    const res = await app().fetch(post("/v1/agents", "s3cret"));
    expect(res.status).toBe(400);
  });

  it("leaves reads open", async () => {
    process.env["CONSOLE_MCP_TOKEN"] = "s3cret";
    const server = app();

    for (const path of ["/health", "/v1/agents"]) {
      const res = await server.fetch(new Request(`http://api.test${path}`));
      expect(res.status, path).toBe(200);
    }
  });

  it("leaves the chat open — it reads and never writes", async () => {
    process.env["CONSOLE_MCP_TOKEN"] = "s3cret";
    const res = await app().fetch(
      new Request("http://api.test/v1/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "show me the fleet" }),
      }),
    );
    expect(res.status).toBe(200);
  });

  it("leaves the fleet's public MCP servers open", async () => {
    // Published in ENS and meant to answer anyone who resolves the record.
    process.env["CONSOLE_MCP_TOKEN"] = "s3cret";
    const res = await createApp(
      { ...config, agentParentName: "nymspace.eth" },
      { store: {} } as unknown as Deps,
    ).fetch(
      new Request("http://api.test/mcp/research", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "t", version: "0" },
          },
        }),
      }),
    );
    expect(res.status).toBe(200);
  });
});
