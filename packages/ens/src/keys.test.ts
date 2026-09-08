import { describe, expect, it } from "vitest";
import { agentEndpointKey, agentRegistrationKey, encodeDnsName } from "./keys";

const SEPOLIA = 11155111;
const REGISTRY = "0x0000000000000000000000000000000000000001";

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

describe("ENSIP 25 and 26 keys", () => {
  it("builds the parameterised registration key from the binary registry form", () => {
    expect(
      agentRegistrationKey({
        chainId: SEPOLIA,
        registry: REGISTRY,
        agentId: "42",
      }),
    ).toBe(
      "agent-registration[0x0001000003aa36a7140000000000000000000000000000000000000001][42]",
    );
  });

  it("can build the same key from the text registry form", () => {
    expect(
      agentRegistrationKey({
        chainId: SEPOLIA,
        registry: REGISTRY,
        agentId: "42",
        registryForm: "text",
      }),
    ).toBe(`agent-registration[eip155:${SEPOLIA}:${REGISTRY}][42]`);
  });

  it("builds endpoint keys per ENSIP 26", () => {
    expect(agentEndpointKey("mcp")).toBe("agent-endpoint[mcp]");
    expect(agentEndpointKey("a2a")).toBe("agent-endpoint[a2a]");
  });
});
