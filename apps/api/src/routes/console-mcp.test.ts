import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import type { Deps } from "../deps";

/**
 * The gate on `/v1/mcp/console`, pinned.
 *
 * This is the one MCP surface in the product that holds `deps` and can spend
 * the organization's gas, and the reason it is gated is that `POST /v1/agents`
 * is not. A regression here would not fail anything else: the tools would keep
 * working, the console would keep rendering, and the only symptom would be
 * that anyone who found the URL could mint subnames. So the gate is tested
 * before the tools are.
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

function consoleApp() {
  return createApp(config, {
    store: { listAgents: async () => [agent] },
    parentName: "nymspace.eth",
    config: { chainId: 11155111 },
    registry: "0x0000000000000000000000000000000000000001",
    resolver: "0x0000000000000000000000000000000000000002",
  } as unknown as Deps);
}

/** One MCP request, at whatever authorization is being tested. */
function initialize(token?: string) {
  return new Request("http://api.test/v1/mcp/console", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      },
    }),
  });
}

/*
  Cleared before as well as after.

  The "unconfigured" case asserts on a variable being *absent*, and a developer
  with `CONSOLE_MCP_TOKEN` in their `.env` inherits it here — the suite passed
  in CI and failed on the machine that had the feature switched on, which is
  the wrong way round for a test guarding a security gate. The absence this
  test needs is now arranged rather than assumed.
*/
beforeEach(() => {
  delete process.env["CONSOLE_MCP_TOKEN"];
});

afterEach(() => {
  delete process.env["CONSOLE_MCP_TOKEN"];
});

describe("the console MCP gate", () => {
  it("is unconfigured rather than open when no token is set", async () => {
    const res = await consoleApp().fetch(initialize());

    // 503 and not 401: with nothing configured there is no credential that
    // would work, and saying "unauthorized" would invite a caller to keep
    // trying one. The body names the variable, the way a missing signer does.
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("CONSOLE_MCP_TOKEN");
  });

  it("refuses a request carrying no token", async () => {
    process.env["CONSOLE_MCP_TOKEN"] = "s3cret";
    const res = await consoleApp().fetch(initialize());

    expect(res.status).toBe(401);
    // Told how to retry, rather than left to guess from a bare 401.
    expect(res.headers.get("www-authenticate")).toContain("Bearer");
  });

  it("refuses a wrong token, including one that shares a prefix", async () => {
    process.env["CONSOLE_MCP_TOKEN"] = "s3cret";

    for (const wrong of ["nope", "s3cre", "s3cret-but-longer", "S3CRET"]) {
      const res = await consoleApp().fetch(initialize(wrong));
      expect(res.status, wrong).toBe(401);
    }
  });

  it("serves the tools to a request carrying the right token", async () => {
    process.env["CONSOLE_MCP_TOKEN"] = "s3cret";
    const res = await consoleApp().fetch(initialize("s3cret"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { serverInfo: { name: string } };
    };
    expect(body.result.serverInfo.name).toBe("console.nymspace.eth");
  });

  /**
   * The regression this pins was found by running the tool.
   *
   * `create_agent` with `label: "research"` — a name the organization already
   * owns — returned 202 and rewrote that agent's on-chain `agent-context`
   * record with the throwaway description sent to test the refusal. The route
   * behaved as designed: "owned by another account" is the only unavailability
   * it checks, and repairing a half-finished agent is a wanted behaviour. But
   * a tool called `create_agent` reaching it means a retry silently overwrites
   * a live agent, and nothing in the tool said so.
   */
  it("refuses to create a label the fleet already holds", async () => {
    process.env["CONSOLE_MCP_TOKEN"] = "s3cret";
    const app = consoleApp();

    const res = await app.fetch(
      new Request("http://api.test/v1/mcp/console", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: "Bearer s3cret",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 9,
          method: "tools/call",
          params: {
            name: "create_agent",
            arguments: {
              label: "research",
              name: "Dup",
              description: "should be refused",
              role: "test",
              controller: "0xDEA25D2537cE06cE1073dd9621C70056CBDC3aEB",
            },
          },
        }),
      }),
    );

    const body = (await res.json()) as {
      result: { content: { text: string }[] };
    };
    const outcome = JSON.parse(body.result.content[0]!.text) as {
      status: string;
      ensName: string;
      reason: string;
    };

    expect(outcome.status).toBe("exists");
    expect(outcome.ensName).toBe("research.nymspace.eth");
    // The refusal has to say what would have happened, or the caller learns
    // nothing and tries again with the same arguments.
    expect(outcome.reason).toContain("agent-context");
    // Not a provisioning run: no 202, and nothing that reads as success.
    expect(outcome).not.toHaveProperty("httpStatus");
  });

  it("leaves the fleet's own public MCP servers ungated", async () => {
    /*
      The two surfaces must not converge. `/mcp/:label` is the endpoint written
      into ENS: read-only, holding no deps, and meant to answer anyone who
      resolves the record. A token reaching it would break the most carefully
      authorized write in the product, so this asserts the gate did not spread
      — and it asserts on a real `/mcp/:label` request rather than on the
      console path under another method, which would pass without testing
      anything.
    */
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
            clientInfo: { name: "test", version: "0" },
          },
        }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { serverInfo: { name: string } };
    };
    expect(body.result.serverInfo.name).toBe("research.nymspace.eth");
  });
});
