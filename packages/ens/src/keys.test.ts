import { describe, expect, it } from "vitest";
import {
  agentEndpointKey,
  agentRegistrationKey,
  agentRegistrationKeyForAgent0Id,
  canonicalAgentId,
  encodeDnsName,
  parseAgent0Id,
  verifyAgentRegistration,
  type RegistryByChainId,
} from "./keys";

const MAINNET = 1;
const SEPOLIA = 11155111;
const BASE_SEPOLIA = 84532;

/**
 * The ERC 8004 identity registry, from `agent0lab/subgraph`
 * `config/networks/eth-sepolia.json`. Base Sepolia deploys the same address, so
 * the cross-chain case differs only in the chain reference.
 */
const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";

const REGISTRIES: RegistryByChainId = {
  [SEPOLIA]: IDENTITY_REGISTRY,
  [BASE_SEPOLIA]: IDENTITY_REGISTRY,
};

describe("DNS wire encoding", () => {
  it("length-prefixes each label and terminates with a zero byte", () => {
    // 08 research | 07 example | 03 eth | 00
    expect(encodeDnsName("research.example.eth")).toBe(
      "0x087265736561726368076578616d706c650365746800",
    );
  });

  it("encodes the root as a lone terminator", () => {
    expect(encodeDnsName("")).toBe("0x00");
  });

  it("rejects a label over 63 bytes, which the wire format cannot express", () => {
    expect(() => encodeDnsName(`${"a".repeat(64)}.eth`)).toThrow(/63 bytes/);
  });
});

describe("ENSIP 25 registration key", () => {
  it("matches the worked example published in ENSIP 25", () => {
    // Registry 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 on chain 1, agent 167.
    expect(
      agentRegistrationKey({
        chainId: MAINNET,
        registry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
        agentId: "167",
      }),
    ).toBe(
      "agent-registration[0x000100000101148004a169fb4a3325136eb29fa0ceb6d2e539a432][167]",
    );
  });

  it("encodes the Sepolia identity registry with a three-byte chain reference", () => {
    expect(
      agentRegistrationKey({
        chainId: SEPOLIA,
        registry: IDENTITY_REGISTRY,
        agentId: 7,
      }),
    ).toBe(
      "agent-registration[0x0001000003aa36a7148004a818bfb912233c491871b3d84c89a494bd9e][7]",
    );
  });

  it("differs from Base Sepolia only in the chain reference", () => {
    // 84532 is 0x014a34 — three bytes, same registry address.
    expect(
      agentRegistrationKey({
        chainId: BASE_SEPOLIA,
        registry: IDENTITY_REGISTRY,
        agentId: 7,
      }),
    ).toBe(
      "agent-registration[0x0001000003014a34148004a818bfb912233c491871b3d84c89a494bd9e][7]",
    );
  });

  it("lowercases a checksummed registry address", () => {
    const key = agentRegistrationKey({
      chainId: SEPOLIA,
      registry: IDENTITY_REGISTRY,
      agentId: 7,
    });
    expect(key).toContain(IDENTITY_REGISTRY.toLowerCase().slice(2));
    expect(key).not.toContain(IDENTITY_REGISTRY.slice(2));
  });

  it("carries no whitespace, which the rendered ENSIP would introduce", () => {
    const key = agentRegistrationKey({
      chainId: SEPOLIA,
      registry: IDENTITY_REGISTRY,
      agentId: 7,
    });
    expect(key).not.toMatch(/\s/);
  });
});

describe("agent id canonicalization", () => {
  it("strips leading zeros so 0167 and 167 are the same record", () => {
    expect(canonicalAgentId("0167")).toBe("167");
    expect(canonicalAgentId("167")).toBe("167");
    expect(canonicalAgentId(167)).toBe("167");
    expect(canonicalAgentId(167n)).toBe("167");
  });

  it("renders a 0x-prefixed id as decimal", () => {
    expect(canonicalAgentId("0xa7")).toBe("167");
  });

  it("rejects the two characters ENSIP 25 forbids", () => {
    expect(() => canonicalAgentId("16[7]")).toThrow(/forbids/);
  });

  it("rejects anything that is not a number", () => {
    expect(() => canonicalAgentId("agent-seven")).toThrow(/not a number/);
  });
});

describe("Agent0 identifier bridge", () => {
  it("splits <chainId>:<agentId>", () => {
    expect(parseAgent0Id("11155111:7")).toEqual({
      chainId: SEPOLIA,
      agentId: "7",
    });
  });

  it("rejects an id that is not two parts", () => {
    expect(() => parseAgent0Id("7")).toThrow(/<chainId>:<agentId>/);
    expect(() => parseAgent0Id("1:2:3")).toThrow(/<chainId>:<agentId>/);
  });

  it("builds the key from an Agent0 id and the configured registry table", () => {
    expect(agentRegistrationKeyForAgent0Id("11155111:7", REGISTRIES)).toBe(
      agentRegistrationKey({
        chainId: SEPOLIA,
        registry: IDENTITY_REGISTRY,
        agentId: "7",
      }),
    );
  });

  it("refuses to guess a registry Agent0 never returns", () => {
    expect(() => agentRegistrationKeyForAgent0Id("1:7", REGISTRIES)).toThrow(
      /No ERC 8004 identity registry configured for chain 1/,
    );
  });
});

describe("ENSIP 25 verification, registry to ENS", () => {
  /** A resolver holding exactly one correctly-constructed key. */
  const granted = agentRegistrationKey({
    chainId: SEPOLIA,
    registry: IDENTITY_REGISTRY,
    agentId: "7",
  });
  const readText = async (_name: string, key: string) =>
    key === granted ? "1" : "";

  it("verifies when the key resolves to a non-empty value", async () => {
    const result = await verifyAgentRegistration({
      name: "research.nymspace.eth",
      chainId: SEPOLIA,
      registry: IDENTITY_REGISTRY,
      agentId: "7",
      readText,
    });
    expect(result.verified).toBe(true);
    expect(result.value).toBe("1");
    expect(Date.parse(result.verifiedAt)).not.toBeNaN();
  });

  // Every failure below reads back as an empty string, which is exactly what an
  // honest "not verified" looks like. These exist so a mis-encoding is caught
  // here rather than debugged against a resolver.
  it("fails on the wrong agent id", async () => {
    const result = await verifyAgentRegistration({
      name: "research.nymspace.eth",
      chainId: SEPOLIA,
      registry: IDENTITY_REGISTRY,
      agentId: "8",
      readText,
    });
    expect(result.verified).toBe(false);
  });

  it("fails on the wrong chain, which is a different chain reference", async () => {
    const result = await verifyAgentRegistration({
      name: "research.nymspace.eth",
      chainId: BASE_SEPOLIA,
      registry: IDENTITY_REGISTRY,
      agentId: "7",
      readText,
    });
    expect(result.verified).toBe(false);
  });

  it("fails on a hand-built key with a checksummed registry", async () => {
    const wrong = `agent-registration[0x0001000003aa36a714${IDENTITY_REGISTRY.slice(2)}][7]`;
    expect(await readText("research.nymspace.eth", wrong)).toBe("");
  });

  it("fails on a hand-built key with a zero-padded chain reference", async () => {
    // 11155111 padded to four bytes rather than encoded minimally.
    const wrong = `agent-registration[0x000100000400aa36a714${IDENTITY_REGISTRY.toLowerCase().slice(2)}][7]`;
    expect(await readText("research.nymspace.eth", wrong)).toBe("");
  });
});

describe("ENSIP 26 keys", () => {
  it("builds endpoint keys", () => {
    expect(agentEndpointKey("mcp")).toBe("agent-endpoint[mcp]");
    expect(agentEndpointKey("a2a")).toBe("agent-endpoint[a2a]");
  });
});
