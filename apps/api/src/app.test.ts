import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Hono } from "hono";
import type { Deps, DepsEnv } from "./deps";
import { describe, expect, it, vi } from "vitest";
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

  it("refuses a non-https MCP endpoint before any chain call", async () => {
    let touched = false;
    const app = appWith({
      store: { getAgent: async () => agent } as unknown as Deps["store"],
      ens: {
        readText: async () => {
          touched = true;
          return "before";
        },
        writeText: async () => {
          touched = true;
          return "0x";
        },
      } as unknown as Deps["ens"],
    });

    for (const value of ["http://localhost:3112/mcp/research", "not a url"]) {
      const res = await app.fetch(
        new Request("http://api.test/v1/agents/agent-research/records", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key: "agent-endpoint[mcp]", value }),
        }),
      );
      expect(res.status, value).toBe(400);
    }
    // Refused by validation, so no read, no write, and no denial row claiming
    // the resolver refused something it was never asked.
    expect(touched).toBe(false);
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

  //////////////////////////////////////////////////////////////////////////
  // The token, and the authority that may exceed the limit
  //////////////////////////////////////////////////////////////////////////

  const USDC = {
    address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    symbol: "USDC",
    decimals: 6,
    // `as const`, so the address keeps its literal type and satisfies the
    // branded `Address` without a cast in five places.
  } as const;

  const walletStore = (extra: Record<string, unknown> = {}) =>
    ({
      getAgent: async () => agent,
      getFinancialAuthority: async () => ({
        agentId: agent.id,
        privyWalletId: "wallet-1",
        walletAddress: "0x310207D93403aE037ee2DF7812d69d58D112C1ca",
        policyId: "pol_1",
      }),
      recordEvent: async (event: Record<string, unknown>) => ({
        ...event,
        id: "event-1",
      }),
      ...extra,
    }) as unknown as Deps["store"];

  const pay = (app: ReturnType<typeof appWith>, body: Record<string, unknown>) =>
    app.fetch(
      new Request("http://api.test/v1/agents/agent-research/payments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  it("sends the configured token rather than a native transfer", async () => {
    let sent: { token?: { symbol: string }; amount?: string } = {};
    const app = appWith({
      store: walletStore(),
      paymentToken: USDC,
      privy: {
        sendPayment: async (_id: string, request: typeof sent) => {
          sent = request;
          return { status: "executed" as const, transactionHash: "0xhash" };
        },
      } as unknown as Deps["privy"],
    });

    const res = await pay(app, {
      amount: "5000000",
      recipient: "0xB5e8e4b8543f2B1093bDCA55A3F7Fd16f56F55C9",
    });

    expect(res.status).toBe(200);
    expect(sent.token?.symbol).toBe("USDC");
    expect(sent.amount).toBe("5000000");
  });

  /**
   * The bug this replaces: `tokenAddress` was declared by the type, ignored by
   * the client, and absent from the schema, so a request naming a token
   * produced a native transfer, a real hash, and a success on screen.
   */
  it("refuses a token it is not configured to pay in", async () => {
    let touched = false;
    const app = appWith({
      store: walletStore(),
      paymentToken: USDC,
      privy: {
        sendPayment: async () => {
          touched = true;
          return { status: "executed" as const, transactionHash: "0xhash" };
        },
      } as unknown as Deps["privy"],
    });

    const res = await pay(app, {
      amount: "5000000",
      recipient: "0xB5e8e4b8543f2B1093bDCA55A3F7Fd16f56F55C9",
      token: "0x0000000000000000000000000000000000000BAd",
    });

    expect(res.status).toBe(400);
    expect(touched).toBe(false);
  });

  it("offers no approval path when no owner key is configured", async () => {
    const app = appWith({
      store: walletStore(),
      paymentToken: USDC,
      privyOwner: undefined,
      privy: {
        sendPayment: async () => ({
          status: "denied" as const,
          reason: "RPC request denied due to policy violation",
        }),
      } as unknown as Deps["privy"],
    });

    const body = (await (
      await pay(app, {
        amount: "100000000",
        recipient: "0xB5e8e4b8543f2B1093bDCA55A3F7Fd16f56F55C9",
      })
    ).json()) as Record<string, unknown>;

    // docs/08: do not offer an approval path that is not implemented. With no
    // second key there is no second authority, and the response says so by
    // omission rather than by a flag.
    expect(body["status"]).toBe("denied");
    expect(body["escalation"]).toBeUndefined();
  });

  it("offers one when an owner key exists, referencing the recorded denial", async () => {
    const app = appWith({
      store: walletStore(),
      paymentToken: USDC,
      privyOwner: {} as unknown as Deps["privyOwner"],
      privy: {
        sendPayment: async () => ({
          status: "denied" as const,
          reason: "RPC request denied due to policy violation",
        }),
      } as unknown as Deps["privy"],
    });

    const body = (await (
      await pay(app, {
        amount: "100000000",
        recipient: "0xB5e8e4b8543f2B1093bDCA55A3F7Fd16f56F55C9",
      })
    ).json()) as { status: string; escalation?: { requestId: string } };

    expect(body.status).toBe("denied");
    expect(body.escalation?.requestId).toBe("event-1");
  });

  it("approves by re-sending the recorded request under the owner's key", async () => {
    let sent: Record<string, unknown> = {};
    let resolved: Record<string, unknown> | undefined;

    const app = appWith({
      store: walletStore({
        getEvent: async () => ({
          id: "event-1",
          agentId: agent.id,
          status: "denied",
          metadata: {
            amount: "100000000",
            recipient: "0xB5e8e4b8543f2B1093bDCA55A3F7Fd16f56F55C9",
            tokenAddress: USDC.address,
          },
        }),
        resolveEvent: async (_id: string, patch: Record<string, unknown>) => {
          resolved = patch;
          return {};
        },
      }),
      paymentToken: USDC,
      privyOwner: {
        sendPayment: async (_id: string, request: Record<string, unknown>) => {
          sent = request;
          return { status: "executed" as const, transactionHash: "0xowner" };
        },
      } as unknown as Deps["privyOwner"],
      privy: {} as unknown as Deps["privy"],
    });

    const res = await app.fetch(
      new Request(
        "http://api.test/v1/agents/agent-research/payments/event-1/approve",
        { method: "POST" },
      ),
    );

    expect(res.status).toBe(200);
    // The amount comes from the denial, never from the approving client — an
    // approval of whatever the client says it approved is not an approval.
    expect(sent["amount"]).toBe("100000000");
    expect(await res.json()).toMatchObject({
      status: "executed",
      transactionHash: "0xowner",
      approvedRequestId: "event-1",
    });
    // The denial is untouched; the pending approval is what resolves.
    expect(resolved?.["status"]).toBe("success");
  });

  it("refuses to approve when no owner key is configured", async () => {
    const app = appWith({
      store: walletStore(),
      privyOwner: undefined,
      privy: {} as unknown as Deps["privy"],
    });

    const res = await app.fetch(
      new Request(
        "http://api.test/v1/agents/agent-research/payments/event-1/approve",
        { method: "POST" },
      ),
    );
    expect(res.status).toBe(409);
  });

  it("refuses to approve an event that is not a denial of this agent's", async () => {
    const app = appWith({
      store: walletStore({
        getEvent: async () => ({
          id: "event-1",
          agentId: "agent-trader",
          status: "denied",
          metadata: {},
        }),
      }),
      privyOwner: { sendPayment: async () => ({}) } as unknown as Deps["privyOwner"],
      privy: {} as unknown as Deps["privy"],
    });

    const res = await app.fetch(
      new Request(
        "http://api.test/v1/agents/agent-research/payments/event-1/approve",
        { method: "POST" },
      ),
    );
    expect(res.status).toBe(404);
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
    expect(await res.json()).toEqual({
      error: "not found",
      path: "/nope",
      requestId: res.headers.get("x-request-id"),
    });
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

/**
 * An app whose process log is captured instead of written to stdout. `lines()`
 * parses on read, so a test that needs the raw text still has `raw`.
 */
function recording(deps?: Deps) {
  const raw: string[] = [];
  const app = createApp(config, deps, (line) => void raw.push(line));
  const lines = () => raw.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { app, raw, lines };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("failure shapes", () => {
  it("returns a generic 500 carrying the request id, and keeps the detail out of the body", async () => {
    const secret = "boom: PRIVY_APP_SECRET=hunter2";
    const { app: throwing, lines } = recording();
    throwing.get("/throws", () => {
      throw new Error(secret);
    });

    const res = await throwing.fetch(new Request("http://api.test/throws"));
    expect(res.status).toBe(500);

    const text = await res.text();
    const requestId = res.headers.get("x-request-id");
    expect(JSON.parse(text)).toEqual({ error: "internal error", requestId });
    expect(text).not.toContain(secret);
    expect(text).not.toContain("PRIVY_APP_SECRET");

    // The detail the body withholds is in the log, under the same id.
    expect(lines()).toContainEqual(
      expect.objectContaining({ level: "error", requestId, errorMessage: secret }),
    );
  });

  it("still logs when the error handler is mounted on a bare Hono", async () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const throwing = new Hono<DepsEnv>();
      throwing.get("/throws", () => {
        throw new Error("bare");
      });
      throwing.onError(errorHandler);
      throwing.notFound(notFoundHandler);

      const res = await throwing.fetch(new Request("http://api.test/throws"));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "internal error" });

      const logged = write.mock.calls
        .map(([chunk]) => String(chunk))
        .filter((chunk) => chunk.startsWith("{"))
        .map((chunk) => JSON.parse(chunk));
      expect(logged).toContainEqual(
        expect.objectContaining({ level: "error", errorMessage: "bare" }),
      );
    } finally {
      write.mockRestore();
    }
  });
});

describe("request ids", () => {
  it("generates one when none is sent, and returns it", async () => {
    const { app: probe } = recording();
    const res = await probe.fetch(new Request("http://api.test/health"));
    expect(res.headers.get("x-request-id")).toMatch(UUID);
  });

  it("carries one on a success, a 404, a 500 and an agent MCP route", async () => {
    const { app: probe } = recording();
    probe.get("/throws", () => {
      throw new Error("x");
    });

    for (const path of ["/health", "/nope", "/throws", "/mcp/research"]) {
      const res = await probe.fetch(new Request(`http://api.test${path}`));
      expect(res.headers.get("x-request-id"), path).toMatch(UUID);
    }
  });

  it("names the request in every failure body", async () => {
    const { app: probe } = recording({
      store: { getAgent: async () => undefined },
    } as unknown as Deps);
    probe.get("/throws", () => {
      throw new Error("x");
    });

    // A 404 from no route, a 404 from an `HTTPException`, a 500, and the MCP
    // route's 503 (this config names no parent).
    for (const path of ["/nope", "/v1/agents/nope/wallet", "/throws", "/mcp/research"]) {
      const res = await probe.fetch(new Request(`http://api.test${path}`));
      const body = await res.json();
      expect(body.requestId, path).toBe(res.headers.get("x-request-id"));
    }
  });

  it("reuses an inbound id, in the response and in the log", async () => {
    const { app: probe, lines } = recording();
    const res = await probe.fetch(
      new Request("http://api.test/health", { headers: { "X-Request-Id": "trace-abc_123=" } }),
    );

    expect(res.headers.get("x-request-id")).toBe("trace-abc_123=");
    expect(lines()[0]?.requestId).toBe("trace-abc_123=");
  });

  // Hono replaces rather than truncates. That is the behaviour worth having: an
  // id cut short would match nothing the caller holds.
  it("replaces an inbound id that is too long or carries other characters", async () => {
    const { app: probe } = recording();

    for (const sent of ["a".repeat(256), "has space", 'quote"d']) {
      const res = await probe.fetch(
        new Request("http://api.test/health", { headers: { "X-Request-Id": sent } }),
      );
      expect(res.headers.get("x-request-id"), sent).toMatch(UUID);
    }
  });
});

describe("the process log", () => {
  const deps = { store: { listActivity: async () => [] } } as unknown as Deps;

  it("writes one flat, single-line JSON object per request", async () => {
    const { app: probe, raw, lines } = recording(deps);
    const paths = ["/health", "/v1/activity", "/mcp/research"];
    const statuses: number[] = [];
    for (const path of paths) {
      statuses.push((await probe.fetch(new Request(`http://api.test${path}`))).status);
    }

    expect(raw).toHaveLength(paths.length);
    for (const line of raw) expect(line).not.toContain("\n");

    lines().forEach((line, i) => {
      expect(line).toMatchObject({
        requestId: expect.stringMatching(UUID),
        message: `GET ${paths[i]} ${statuses[i]}`,
        method: "GET",
        path: paths[i],
        status: statuses[i],
        durationMs: expect.any(Number),
      });
      for (const value of Object.values(line)) {
        expect(["string", "number", "boolean"]).toContain(typeof value);
      }
    });
  });

  it("logs a successful liveness check at debug and a product read at info", async () => {
    const { app: probe, lines } = recording(deps);
    await probe.fetch(new Request("http://api.test/health"));
    const activity = await probe.fetch(new Request("http://api.test/v1/activity"));

    expect(activity.status).toBe(200);
    expect(lines().map((line) => line.level)).toEqual(["debug", "info"]);
  });

  it("logs the path without its query string", async () => {
    const { app: probe, lines } = recording(deps);
    await probe.fetch(new Request("http://api.test/v1/activity?limit=5&agent=agent-research"));

    expect(lines()[0]).toMatchObject({
      path: "/v1/activity",
      message: expect.not.stringContaining("?"),
    });
  });

  it("logs a thrown error beside the 500 it answered, under one id", async () => {
    const { app: probe, lines } = recording();
    probe.get("/throws", () => {
      throw new TypeError("nope");
    });

    const res = await probe.fetch(new Request("http://api.test/throws"));
    const requestId = res.headers.get("x-request-id");

    const [errorLine, requestLine, ...rest] = lines();
    expect(rest).toEqual([]);
    expect(errorLine).toMatchObject({
      level: "error",
      message: "unhandled TypeError",
      requestId,
      method: "GET",
      path: "/throws",
      errorName: "TypeError",
      errorMessage: "nope",
      stack: expect.stringContaining("TypeError: nope"),
    });
    // Written after Hono ran `onError`, so it records the status the client saw.
    expect(requestLine).toMatchObject({ level: "error", requestId, status: 500 });
  });

  it("writes nothing to stdout when given a sink", async () => {
    const write = vi.spyOn(process.stdout, "write");
    try {
      const { app: probe } = recording();
      await probe.fetch(new Request("http://api.test/health"));
      expect(write).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
    }
  });
});

describe("the request id across origins", () => {
  const preflightFor = (path: string, origin: string) =>
    recording().app.fetch(
      new Request(`http://api.test${path}`, {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "x-request-id",
        },
      }),
    );

  it("is exposed to, and accepted from, a configured origin", async () => {
    const res = await preflightFor("/health", "http://localhost:3111");
    expect(res.headers.get("access-control-expose-headers")).toContain("x-request-id");
    expect(res.headers.get("access-control-allow-headers")).toContain("x-request-id");
  });

  it("is exposed on the actual response, not only the preflight", async () => {
    const res = await recording().app.fetch(
      new Request("http://api.test/health", { headers: { Origin: "http://localhost:3111" } }),
    );
    expect(res.headers.get("access-control-expose-headers")).toContain("x-request-id");
  });

  it("is exposed to, and accepted from, any origin on an agent MCP route", async () => {
    const res = await preflightFor("/mcp/research", "http://inspector.test");
    expect(res.headers.get("access-control-expose-headers")).toContain("x-request-id");
    expect(res.headers.get("access-control-allow-headers")).toContain("x-request-id");
  });
});

describe("creating an agent", () => {
  const ZERO = "0x0000000000000000000000000000000000000000";
  const ORGANIZATION = "0x1111111111111111111111111111111111111111";
  const CONTROLLER = "0x2222222222222222222222222222222222222222";
  const RESOLVER = "0x3333333333333333333333333333333333333333";
  const REGISTRY = "0x4444444444444444444444444444444444444444";
  const HASH = `0x${"a".repeat(64)}`;

  const body = {
    label: "research",
    name: "Research",
    description: "Finds and ranks other agents.",
    role: "May update its own MCP endpoint record.",
    controller: CONTROLLER,
    endpoints: { mcp: "https://mcp.example/research" },
    delegate: true,
  };

  /**
   * The chain fake answers reads and records writes. The route starts
   * provisioning after it responds, so these tests assert on the response and
   * on what the store was asked to do — the sequence itself is covered against
   * a fake chain in `provisioning.test.ts`.
   */
  function containerFor(owner: string) {
    const written: string[] = [];
    const text: Record<string, string> = {};

    const ens = {
      findOwner: async () => owner,
      getResolver: async () => RESOLVER,
      registerSubname: async () => HASH,
      waitForReceipt: async () => ({ status: "success" }),
      readText: async (_n: string, key: string) => text[key] ?? "",
      writeText: async ({ key, value }: { key: string; value: string }) => {
        text[key] = value;
        return HASH;
      },
      resolverHasRoles: async () => false,
      authorizeTextRole: async () => HASH,
      canSetText: async () => false,
    };

    const store = {
      upsertAgent: async (a: { id: string }) => {
        written.push(a.id);
        return a;
      },
      recordEvent: async () => undefined,
      setProvisioning: async () => undefined,
      getAgent: async () => undefined,
      listActivity: async () => [],
    };

    return {
      written,
      deps: {
        ens,
        store,
        resolver: RESOLVER,
        registry: REGISTRY,
        organization: ORGANIZATION,
        parentName: "nymspace.eth",
      } as unknown as Deps,
    };
  }

  const post = (app: ReturnType<typeof createApp>, payload: unknown) =>
    app.fetch(
      new Request("http://api.test/v1/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );

  it("answers 202 with the id before provisioning finishes", async () => {
    const { deps, written } = containerFor(ZERO);
    const res = await post(createApp(config, deps), body);

    expect(res.status).toBe(202);
    const json = (await res.json()) as Record<string, string>;
    expect(json).toMatchObject({
      id: "agent-research",
      ensName: "research.nymspace.eth",
      status: "provisioning",
    });
    // The row exists before the caller is told to poll for it. Only the first
    // entry is asserted: provisioning is already running behind the response
    // and upserts the same row again, which is the idempotency working.
    expect(written[0]).toBe("agent-research");
  });

  it("refuses a label owned by someone else, and writes nothing", async () => {
    const stranger = "0x9999999999999999999999999999999999999999";
    const { deps, written } = containerFor(stranger);
    const res = await post(createApp(config, deps), body);

    expect(res.status).toBe(409);
    const json = (await res.json()) as Record<string, string>;
    expect(json.status).toBe("unavailable");
    expect(json.owner).toBe(stranger);
    expect(written).toEqual([]);
  });

  it("rejects a label that is not a label", async () => {
    const { deps } = containerFor(ZERO);
    const res = await post(createApp(config, deps), { ...body, label: "Research Agent" });
    expect(res.status).toBe(400);
  });

  it("logs a provisioning failure under the creating request's id, even with the store down", async () => {
    const { deps } = containerFor(ZERO);

    // The route's own upsert succeeds, so the caller is told 202. Every store
    // write after that fails, as it would with Postgres gone: provisioning
    // throws on its first write, and both writes recording the failure throw
    // too. Before this change all three vanished.
    let upserts = 0;
    const down = () => Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:5433"));
    Object.assign(deps.store, {
      upsertAgent: async (a: { id: string }) => (upserts++ === 0 ? a : down()),
      setProvisioning: down,
      recordEvent: down,
    });

    const raw: string[] = [];
    const res = await post(createApp(config, deps, (line) => void raw.push(line)), body);
    expect(res.status).toBe(202);
    const requestId = res.headers.get("x-request-id");

    const forAgent = () =>
      raw
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((line) => line.agentId === "agent-research");
    await vi.waitFor(() => expect(forAgent()).toHaveLength(3));

    // In this order: the cause is on record before either write is tried.
    expect(forAgent()).toEqual([
      expect.objectContaining({
        level: "error",
        message: "provisioning stopped",
        requestId,
        ensName: "research.nymspace.eth",
        errorMessage: "connect ECONNREFUSED 127.0.0.1:5433",
      }),
      expect.objectContaining({
        level: "error",
        message: "could not record provisioning failure",
        requestId,
        write: "setProvisioning",
      }),
      expect.objectContaining({
        level: "error",
        message: "could not record provisioning failure",
        requestId,
        write: "recordEvent",
      }),
    ]);
  });

  it("reports progress as the five tracks and the steps behind them", async () => {
    const agentRow = {
      id: "agent-research",
      ensName: "research.nymspace.eth",
      provisioning: {
        ens: "pending",
        erc8004: "unregistered",
        ensip25: "unchecked",
        graph: "not_indexed",
        financial: "no_wallet",
      },
    };

    const app = createApp(config, {
      store: {
        getAgent: async () => agentRow,
        listActivity: async () => [
          {
            type: "ens.record.updated",
            status: "success",
            summary: "Wrote agent-context on research.nymspace.eth",
            occurredAt: "2026-09-09T00:00:02.000Z",
            evidence: { source: "ens", txHash: HASH, contractAddress: RESOLVER },
            metadata: { phase: "provisioning", readBack: "{}" },
          },
          {
            type: "agent.created",
            status: "success",
            summary: "Registered research.nymspace.eth",
            occurredAt: "2026-09-09T00:00:01.000Z",
            evidence: { source: "ens", txHash: HASH, contractAddress: REGISTRY },
            metadata: { phase: "provisioning", readBack: ORGANIZATION },
          },
          {
            // A later controller write, same type as a provisioning step and
            // not part of the run. The phase stamp is what separates them.
            type: "ens.record.updated",
            status: "success",
            summary: "Controller wrote agent-endpoint[mcp]",
            occurredAt: "2026-09-09T00:05:00.000Z",
            evidence: { source: "ens", txHash: HASH, contractAddress: RESOLVER },
            metadata: { key: "agent-endpoint[mcp]" },
          },
          {
            // Not a provisioning step either. A payment on the same agent must
            // not appear in the create screen's step list.
            type: "privy.payment.executed",
            status: "success",
            summary: "Paid 5 USDC",
            occurredAt: "2026-09-09T00:00:03.000Z",
            evidence: {
              source: "privy",
              walletId: "w1",
              policyId: "p1",
              requestedAt: "2026-09-09T00:00:03.000Z",
            },
          },
        ],
      } as unknown as Deps["store"],
    } as Deps);

    const res = await app.fetch(
      new Request("http://api.test/v1/agents/agent-research/provisioning"),
    );
    expect(res.status).toBe(200);

    const json = (await res.json()) as {
      tracks: Record<string, string>;
      steps: { what: string; readBack: string | null }[];
      complete: boolean;
    };

    expect(Object.keys(json.tracks).sort()).toEqual([
      "ens",
      "ensip25",
      "erc8004",
      "financial",
      "graph",
    ]);
    // Oldest first, and the payment is not among them.
    expect(json.steps.map((s) => s.what)).toEqual([
      "Registered research.nymspace.eth",
      "Wrote agent-context on research.nymspace.eth",
    ]);
    expect(json.steps[0]!.readBack).toBe(ORGANIZATION);
    // The ENS track is still moving, so the screen keeps polling.
    expect(json.complete).toBe(false);
  });
});

describe("the signing accounts", () => {
  const ORGANIZATION = "0x1111111111111111111111111111111111111111";
  const CONTROLLER = "0x2222222222222222222222222222222222222222";

  const get = (app: ReturnType<typeof createApp>) =>
    app.fetch(new Request("http://api.test/v1/signers"));

  it("serves both addresses and the read time", async () => {
    const deps = { organization: ORGANIZATION, controller: CONTROLLER } as unknown as Deps;
    const res = await get(createApp(config, deps));

    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, string>;
    expect(json.organization).toBe(ORGANIZATION);
    expect(json.controller).toBe(CONTROLLER);
    // Every read in this API says when it was read; a bare address reads as a
    // constant and this one changes with the deployment.
    expect(Date.parse(json.readAt!)).not.toBeNaN();
  });

  /**
   * The route is only useful if it is reachable, and `DEPENDENT_ROUTES` is a
   * hand-maintained list. A path missing from it runs with `c.var.deps`
   * undefined and throws on the first destructure, which surfaces as a generic
   * 500 rather than as anything naming the cause.
   */
  it("receives its dependencies", async () => {
    const res = await get(createApp(config, { organization: "0x0", controller: "0x0" } as unknown as Deps));
    expect(res.status).not.toBe(500);
  });
});

describe("GET /v1/activity/summary", () => {
  const summary = {
    bySource: [
      { source: "privy", pending: 0, success: 41, denied: 18, failed: 0, total: 59 },
      { source: "graph", pending: 0, success: 5, denied: 0, failed: 3, total: 8 },
    ],
    total: 67,
  };

  it("serves the counts with denied and failed intact, and the read time", async () => {
    const calls: unknown[] = [];
    const deps = {
      store: {
        summarizeActivity: async (filter: unknown) => {
          calls.push(filter);
          return summary;
        },
      },
    } as unknown as Deps;

    const res = await createApp(config, deps).fetch(
      new Request("http://api.test/v1/activity/summary"),
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as typeof summary & { readAt: string };
    expect(json.bySource).toEqual(summary.bySource);
    expect(json.total).toBe(67);
    expect(Date.parse(json.readAt)).not.toBeNaN();
    // Scoped to this deployment's organization, never unscoped: the store is
    // multi-tenant and an unscoped count is every organization's events.
    expect(calls).toEqual([{ organizationId: expect.any(String) }]);
  });
});
