import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Hono } from "hono";
import type { Deps, DepsEnv } from "./deps";
import { describe, expect, it } from "vitest";
import { createApp, errorHandler, notFoundHandler } from "./app";
import type { ApiConfig } from "./config";

/**
 * Every test drives `app.fetch` with a constructed Request. No port is bound,
 * so these cannot collide with a running dev server or with each other under
 * Turborepo's parallelism.
 */

const config: ApiConfig = {
  port: 0,
  allowedOrigins: ["http://localhost:3111", "https://nymspace.example"],
};

const app = createApp(config);

const get = (path: string, init?: RequestInit) =>
  app.fetch(new Request(`http://api.test${path}`, init));

const preflight = (origin: string) =>
  get("/health", {
    method: "OPTIONS",
    headers: { Origin: origin, "Access-Control-Request-Method": "GET" },
  });

describe("health", () => {
  it("reports liveness without touching a provider", async () => {
    const res = await get("/health");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toMatchObject({ status: "ok", service: "@nymspace/api" });
    expect(typeof body.uptime).toBe("number");
  });
});

describe("the product routes, against injected dependencies", () => {
  /**
   * A hand-built container rather than a mocking library.
   *
   * `Deps` is an interface, so a fake is an object literal that typechecks
   * against the same shape the real one satisfies — a route reaching for
   * something the fake does not provide is a compile error rather than an
   * `undefined` at runtime. Only the members each test exercises are filled in;
   * the cast is confined to this helper so no test carries one.
   */
  function appWith(overrides: Partial<Deps>) {
    return createApp(config, overrides as Deps);
  }

  const agent = {
    id: "agent-research",
    organizationId: "nymspace",
    slug: "research",
    ensName: "research.nymspace.eth",
    controllerAddress: "0xDEA25D2537cE06cE1073dd9621C70056CBDC3aEB",
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
    provisioning: {
      ens: "active",
      erc8004: "registered",
      ensip25: "verified",
      graph: "indexed",
      financial: "policy_configured",
    },
  };

  it("lists the fleet with five separate integration states", async () => {
    const app = appWith({
      store: {
        listAgents: async () => [agent],
      } as unknown as Deps["store"],
    });

    const res = await app.fetch(new Request("http://api.test/v1/agents"));
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      agents: { status: Record<string, string> }[];
      readAt: string;
    };
    // The requirement is that no single value can hide an incomplete
    // integration — docs/09's closing instruction.
    expect(Object.keys(body.agents[0]!.status).sort()).toEqual([
      "ens",
      "ensip25",
      "erc8004",
      "financial",
      "graph",
    ]);
    expect(body.agents[0]).not.toHaveProperty("active");
  });

  /**
   * Task 6.11. Asserted over every payload rather than spot-checked, because
   * the failure it guards against is one route quietly forgetting — and a
   * response with no read time is indistinguishable from a live one by the time
   * the console renders it.
   */
  it("attaches a read time to every externally-derived payload", async () => {
    const app = appWith({
      store: {
        listAgents: async () => [agent],
        getAgent: async () => agent,
        getFinancialAuthority: async () => undefined,
      } as unknown as Deps["store"],
    });

    for (const path of ["/v1/agents", "/v1/agents/agent-research/wallet"]) {
      const res = await app.fetch(new Request(`http://api.test${path}`));
      const body = (await res.json()) as Record<string, unknown>;
      const stamp = body["readAt"] ?? body["fetchedAt"];
      expect(stamp, `${path} carries no read time`).toBeTypeOf("string");
      expect(Number.isFinite(Date.parse(String(stamp)))).toBe(true);
    }
  });

  it("fails a payload that carries no read time", async () => {
    // The complement of the check above: the assertion itself must be able to
    // fail, or it is decoration.
    const withoutStamp = { agents: [] } as Record<string, unknown>;
    const stamp = withoutStamp["readAt"] ?? withoutStamp["fetchedAt"];
    expect(stamp).toBeUndefined();
  });

  it("answers 404 for an unknown agent rather than a 500", async () => {
    const app = appWith({
      store: { getAgent: async () => undefined } as unknown as Deps["store"],
    });

    const res = await app.fetch(
      new Request("http://api.test/v1/agents/nope/wallet"),
    );
    expect(res.status).toBe(404);
    // JSON, not the text body `HTTPException` produces by default — docs/10
    // opens by saying every response is JSON.
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("not found"),
      status: 404,
    });
  });

  it("rejects a malformed address before any domain call", async () => {
    let touched = false;
    const app = appWith({
      store: {
        getAgent: async () => {
          touched = true;
          return agent;
        },
      } as unknown as Deps["store"],
    });

    const res = await app.fetch(
      new Request("http://api.test/v1/agents/agent-research/permissions?controller=nope"),
    );
    expect(res.status).toBe(400);
    // Validation runs before the handler, so nothing downstream was reached.
    expect(touched).toBe(false);
  });

  it("rejects a payment amount that is not a decimal wei string", async () => {
    const app = appWith({
      store: { getAgent: async () => agent } as unknown as Deps["store"],
    });

    const res = await app.fetch(
      new Request("http://api.test/v1/agents/agent-research/payments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount: "0.5", recipient: agent.controllerAddress }),
      }),
    );
    expect(res.status).toBe(400);
  });

  /**
   * Task 6.12, and the one that matters most. An authorization denial reaching
   * the console as a 500 would put the product's central proof on the same path
   * as an outage.
   */
  it("returns an EAC denial as a described 200, not a 500", async () => {
    const app = appWith({
      resolver: "0x45DaD53A7ad21fd62709DFa46e65C7501ed7C6eC",
      store: {
        getAgent: async () => agent,
        recordEvent: async () => ({}),
      } as unknown as Deps["store"],
      ens: {
        readText: async () => "before",
        writeText: async () => {
          throw new Error(
            'The contract function "setText" reverted.\nError: EACUnauthorizedAccountRoles(uint256 resource, uint256 roleBitmap, address account)',
          );
        },
      } as unknown as Deps["ens"],
    });

    const res = await app.fetch(
      new Request("http://api.test/v1/agents/agent-research/records", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: "agent-endpoint[mcp]", value: "https://x" }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "denied",
      source: "ensv2",
      reason: "EACUnauthorizedAccountRoles",
      // The old value travels with the denial so the proof screen can show what
      // did not change.
      before: "before",
    });
  });

  it("separates a revert with another cause from an authorization denial", async () => {
    const app = appWith({
      resolver: "0x45DaD53A7ad21fd62709DFa46e65C7501ed7C6eC",
      store: {
        getAgent: async () => agent,
        recordEvent: async () => ({}),
      } as unknown as Deps["store"],
      ens: {
        readText: async () => "",
        writeText: async () => {
          throw new Error("insufficient funds for gas * price + value");
        },
      } as unknown as Deps["ens"],
    });

    const res = await app.fetch(
      new Request("http://api.test/v1/agents/agent-research/records", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: "agent-endpoint[mcp]", value: "https://x" }),
      }),
    );

    // Out of gas is not the boundary holding, and reporting it as a denial
    // would credit an access control that never ran.
    expect(await res.json()).toMatchObject({ status: "failed" });
  });

  it("returns a policy denial as a 200 with the provider's reason", async () => {
    const app = appWith({
      store: {
        getAgent: async () => agent,
        getFinancialAuthority: async () => ({
          agentId: agent.id,
          privyWalletId: "wallet-1",
          walletAddress: "0x310207D93403aE037ee2DF7812d69d58D112C1ca",
          policyId: "pol_1",
        }),
        recordEvent: async () => ({}),
      } as unknown as Deps["store"],
      privy: {
        sendPayment: async () => ({
          status: "denied" as const,
          reason: "RPC request denied due to policy violation",
        }),
      } as unknown as Deps["privy"],
    });

    const res = await app.fetch(
      new Request("http://api.test/v1/agents/agent-research/payments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount: "10000000000000000",
          recipient: "0xB5e8e4b8543f2B1093bDCA55A3F7Fd16f56F55C9",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "denied",
      reason: "RPC request denied due to policy violation",
    });
  });
});

/**
 * Task 6.14. The declaration check has its own script, and this asserts the
 * script is actually wired — a check nobody runs is a check that does not
 * exist.
 */
describe("environment declarations", () => {
  it("keeps turbo.json and .env.example in agreement", () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const turbo = JSON.parse(
      readFileSync(resolve(root, "turbo.json"), "utf8"),
    ) as { globalEnv?: string[] };
    const example = readFileSync(resolve(root, ".env.example"), "utf8");

    const documented = new Set(
      example
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"))
        .map((line) => line.split("=")[0]!.trim()),
    );

    const undeclared = (turbo.globalEnv ?? []).filter((name) => !documented.has(name));
    const undocumented = [...documented].filter(
      (name) => !(turbo.globalEnv ?? []).includes(name),
    );

    expect({ undeclared, undocumented }).toEqual({
      undeclared: [],
      undocumented: [],
    });
  });
});

describe("unknown paths", () => {
  it("returns 404 in the same JSON error shape every other failure uses", async () => {
    const res = await get("/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found", path: "/nope" });
  });

  it("reports a 404 under the version prefix too", async () => {
    const res = await get("/v1/nope");
    expect(res.status).toBe(404);
    expect((await res.json()).path).toBe("/v1/nope");
  });
});

describe("cross-origin access", () => {
  it("allows a configured origin", async () => {
    const res = await preflight("http://localhost:3111");
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:3111",
    );
  });

  it("allows every configured origin, not only the first", async () => {
    const res = await preflight("https://nymspace.example");
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "https://nymspace.example",
    );
  });

  // The negative case is the one that matters: a permissive default would pass
  // every test above and still expose the API to any page on the internet.
  it("does not allow an unconfigured origin", async () => {
    const res = await preflight("http://evil.test");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("failure shapes", () => {
  it("returns a generic 500 and keeps the detail out of the body", async () => {
    const secret = "boom: PRIVY_APP_SECRET=hunter2";
    const throwing = new Hono<DepsEnv>();
    throwing.get("/throws", () => {
      throw new Error(secret);
    });
    throwing.onError(errorHandler);
    throwing.notFound(notFoundHandler);

    const res = await throwing.fetch(new Request("http://api.test/throws"));
    expect(res.status).toBe(500);

    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "internal error" });
    expect(text).not.toContain(secret);
    expect(text).not.toContain("PRIVY_APP_SECRET");
  });
});
