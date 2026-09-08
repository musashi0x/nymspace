import { Hono } from "hono";
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

describe("agent key derivation", () => {
  it("derives the DNS name and the ENSIP 26 keys", async () => {
    const res = await get("/v1/agents/research.example.eth/keys");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.name).toBe("research.example.eth");
    expect(body.dnsName).toBe("0x087265736561726368076578616d706c650365746800");
    expect(body.keys).toMatchObject({
      context: "agent-context",
      mcp: "agent-endpoint[mcp]",
      a2a: "agent-endpoint[a2a]",
    });
  });

  it("omits the registration key when the registry is not supplied", async () => {
    const res = await get("/v1/agents/x.eth/keys");
    expect((await res.json()).keys.registration).toBeNull();
  });

  it("builds the ENSIP 25 key from an ERC 7930 interoperable address", async () => {
    const res = await get(
      "/v1/agents/x.eth/keys?registry=0x0000000000000000000000000000000000000001&agentId=42",
    );
    expect((await res.json()).keys.registration).toBe(
      "agent-registration[0x0001000003aa36a7140000000000000000000000000000000000000001][42]",
    );
  });

  it("rejects a malformed registry address before any domain call", async () => {
    const res = await get("/v1/agents/x.eth/keys?registry=0xdeadbeef&agentId=1");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/registry/);
  });

  it("rejects a registry supplied without an agent id", async () => {
    const res = await get(
      "/v1/agents/x.eth/keys?registry=0x0000000000000000000000000000000000000001",
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/together/);
  });

  it("rejects an agent id supplied without a registry", async () => {
    const res = await get("/v1/agents/x.eth/keys?agentId=42");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/together/);
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
    const throwing = new Hono();
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
