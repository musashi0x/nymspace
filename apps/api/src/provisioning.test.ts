import { describe, expect, it } from "vitest";
import type { Address, Hex } from "@nymspace/core";
import { AGENT_CONTEXT_KEY, agentEndpointKey } from "@nymspace/ens";
import {
  LabelUnavailableError,
  isValidLabel,
  provisionAgent,
  type ProvisionContext,
  type ProvisionTarget,
} from "./provisioning";

/**
 * The property under test is not "it provisions". It is that it does not spend
 * twice.
 *
 * `POST /v1/agents` is safe to re-send only because every step reads chain
 * state first, and a fake chain is the only place that claim can be checked
 * without paying for it. The second test is therefore the important one: it
 * asserts on the *absence* of writes, which is the behaviour a refactor is
 * most likely to break silently.
 */

const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const ORGANIZATION = "0x1111111111111111111111111111111111111111" as Address;
const CONTROLLER = "0x2222222222222222222222222222222222222222" as Address;
const RESOLVER = "0x3333333333333333333333333333333333333333" as Address;
const REGISTRY = "0x4444444444444444444444444444444444444444" as Address;
const HASH = `0x${"a".repeat(64)}` as Hex;

const MCP = "https://mcp.example/research";
const MCP_KEY = agentEndpointKey("mcp");

interface FakeChain {
  owner: Address;
  resolver: Address;
  text: Record<string, string>;
  granted: Set<string>;
}

interface Calls {
  register: number;
  writes: string[];
  grants: string[];
}

function fakes(chain: FakeChain) {
  const calls: Calls = { register: 0, writes: [], grants: [] };

  const ens = {
    findOwner: async () => chain.owner,
    getResolver: async () => chain.resolver,
    registerSubname: async () => {
      calls.register += 1;
      chain.owner = ORGANIZATION;
      chain.resolver = RESOLVER;
      return HASH;
    },
    waitForReceipt: async () => ({ status: "success" as const }),
    readText: async (_name: string, key: string) => chain.text[key] ?? "",
    writeText: async ({ key, value }: { key: string; value: string }) => {
      calls.writes.push(key);
      chain.text[key] = value;
      return HASH;
    },
    resolverHasRoles: async () => chain.granted.has(MCP_KEY),
    authorizeTextRole: async ({ key }: { key: string }) => {
      calls.grants.push(key);
      chain.granted.add(key);
      return HASH;
    },
    // The controller reaches what it was granted and nothing else. A fake that
    // answered true for every key would make the read-back assertion vacuous.
    canSetText: async (_name: string, key: string) => chain.granted.has(key),
  };

  const store = {
    upsertAgent: async () => undefined,
    recordEvent: async () => undefined,
    setProvisioning: async () => undefined,
  };

  const context = {
    ens,
    store,
    organizationId: "nymspace",
    parentName: "nymspace.eth",
    registry: REGISTRY,
    resolver: RESOLVER,
    organization: ORGANIZATION,
  } as unknown as ProvisionContext;

  return { context, calls };
}

const target: ProvisionTarget = {
  label: "research",
  name: "Research",
  description: "Finds and ranks other agents.",
  role: "May update its own MCP endpoint record.",
  controller: CONTROLLER,
  endpoints: { mcp: MCP },
  delegate: true,
};

describe("isValidLabel", () => {
  it("accepts what a subname may be and rejects what it may not", () => {
    expect(isValidLabel("research")).toBe(true);
    expect(isValidLabel("research-2")).toBe(true);
    expect(isValidLabel("Research")).toBe(false);
    expect(isValidLabel("-research")).toBe(false);
    expect(isValidLabel("re search")).toBe(false);
    expect(isValidLabel("")).toBe(false);
  });
});

describe("provisionAgent", () => {
  it("registers, publishes and delegates a fresh label", async () => {
    const { context, calls } = fakes({
      owner: ZERO,
      resolver: ZERO,
      text: {},
      granted: new Set(),
    });

    const result = await provisionAgent(context, target);

    expect(result.ens).toBe("active");
    expect(calls.register).toBe(1);
    expect(calls.writes).toEqual([AGENT_CONTEXT_KEY, MCP_KEY]);
    expect(calls.grants).toEqual([MCP_KEY]);
    expect(result.steps.every((s) => s.ok)).toBe(true);
    expect(result.steps.some((s) => s.skipped)).toBe(false);
  });

  it("spends nothing on a label that is already fully provisioned", async () => {
    const { context, calls } = fakes({
      owner: ZERO,
      resolver: ZERO,
      text: {},
      granted: new Set(),
    });

    await provisionAgent(context, target);
    const before = { ...calls, writes: [...calls.writes], grants: [...calls.grants] };

    const again = await provisionAgent(context, target);

    expect(calls.register).toBe(before.register);
    expect(calls.writes).toEqual(before.writes);
    expect(calls.grants).toEqual(before.grants);
    expect(again.ens).toBe("active");
    // Every step that could have spent reports why it did not, rather than
    // vanishing — design D2.
    expect(again.steps.filter((s) => s.skipped).length).toBeGreaterThan(0);
    expect(again.steps.every((s) => s.ok)).toBe(true);
  });

  it("refuses a label owned by someone else before writing anything", async () => {
    const stranger = "0x9999999999999999999999999999999999999999" as Address;
    const { context, calls } = fakes({
      owner: stranger,
      resolver: RESOLVER,
      text: {},
      granted: new Set(),
    });

    await expect(provisionAgent(context, target)).rejects.toBeInstanceOf(
      LabelUnavailableError,
    );
    expect(calls.register).toBe(0);
    expect(calls.writes).toEqual([]);
  });

  it("leaves the ENS track failed when the resolver did not attach", async () => {
    const { context } = fakes({
      owner: ORGANIZATION,
      resolver: ZERO,
      text: {},
      granted: new Set(),
    });

    const result = await provisionAgent(context, target);

    expect(result.ens).toBe("failed");
    expect(result.steps.at(-1)?.ok).toBe(false);
  });
});
