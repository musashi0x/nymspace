import { describe, expect, it } from "vitest";
import type { Address } from "@nymspace/core";
import {
  buildRegistrationFile,
  decodeRegistrationFileUri,
  encodeRegistrationFileUri,
  claimedEnsName,
  REGISTRATION_FILE_TYPE,
} from "./erc8004";
import { agentRegistrationKey } from "./keys";
import { isFinding, verifyEnsip25, type Ensip25Status } from "./ensip25";

/**
 * Task 3.14 — the negative verification tests.
 *
 * The requirement has two halves and the second is the one that matters: each
 * mis-encoding must fail, *and* each must be distinguishable from an RPC
 * failure. The spike already proved that a wrong agent id, a checksummed
 * registry, and a zero-padded chain reference all fail as an empty read — which
 * means they are indistinguishable from an honest "this agent never wrote the
 * record", and would be indistinguishable from a timeout too if the verifier
 * collapsed failures. These tests pin the distinction.
 */

const REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as Address;
const SEPOLIA = 11155111;
const BASE_SEPOLIA = 84532;
const NAME = "research.nymspace.eth";
const AGENT_ID = "1";

/** A registry stub that claims whatever the test says it claims. */
function registryClaiming(claimed: string | undefined) {
  return {
    async claimsEnsName(_agentId: string | number | bigint, ensName: string) {
      return {
        claims: claimed?.toLowerCase() === ensName.toLowerCase(),
        ...(claimed && { claimed }),
      };
    },
  };
}

const registryThatFails = {
  async claimsEnsName(): Promise<never> {
    throw new Error("HTTP request failed: 503 Service Unavailable");
  },
};

/** An ENS stub holding exactly one key, so a wrong key reads empty. */
function ensHolding(records: Record<string, string>) {
  return async (_name: string, key: string) => records[key] ?? "";
}

const correctKey = agentRegistrationKey({
  chainId: SEPOLIA,
  registry: REGISTRY,
  agentId: AGENT_ID,
});

async function verify(overrides: {
  claimed?: string;
  records?: Record<string, string>;
  chainId?: number;
  agentId?: string;
  erc8004?: { claimsEnsName: (...args: never[]) => Promise<never> };
  readText?: (name: string, key: string) => Promise<string>;
}) {
  return verifyEnsip25({
    ensName: NAME,
    agentId: overrides.agentId ?? AGENT_ID,
    registry: REGISTRY,
    chainId: overrides.chainId ?? SEPOLIA,
    erc8004: (overrides.erc8004 ??
      registryClaiming(
        "claimed" in overrides ? overrides.claimed : NAME,
      )) as never,
    readText: overrides.readText ?? ensHolding(overrides.records ?? {}),
  });
}

describe("the happy path", () => {
  it("verifies when the registry claims the name and ENS confirms it", async () => {
    const result = await verify({ records: { [correctKey]: "1" } });

    expect(result.status).toBe("verified");
    expect(result.key).toBe(correctKey);
    expect(result.claimedEnsName).toBe(NAME);
    // ENSIP 25's own security note: a name transfer can leave a stale
    // attestation, so the result is only true as of when it was read.
    expect(Date.parse(result.readAt)).not.toBeNaN();
  });

  it("accepts any non-empty value, because ENSIP 25 says the value is meaningless", async () => {
    for (const value of ["1", "true", "yes", "0", "{}"]) {
      const result = await verify({ records: { [correctKey]: value } });
      expect(result.status, `value ${JSON.stringify(value)}`).toBe("verified");
    }
  });
});

describe("the four failure states are distinct", () => {
  it("registry_claim_missing when the registration claims no name at all", async () => {
    const result = await verify({ claimed: undefined, records: {} });

    expect(result.status).toBe("registry_claim_missing");
    // Never reached the ENS side, so there is no key to report.
    expect(result.key).toBeUndefined();
  });

  it("mismatch when the registration claims a different name", async () => {
    const result = await verify({
      claimed: "trader.nymspace.eth",
      records: { [correctKey]: "1" },
    });

    expect(result.status).toBe("mismatch");
    expect(result.claimedEnsName).toBe("trader.nymspace.eth");
    expect(result.expectedEnsName).toBe(NAME);
  });

  it("ens_record_missing when the claim is right and ENS is silent", async () => {
    const result = await verify({ records: {} });

    expect(result.status).toBe("ens_record_missing");
    // The key is reported precisely because this is the state a bug in our own
    // key construction lands in — without it there is nothing to diagnose.
    expect(result.key).toBe(correctKey);
  });

  it("rpc_error when the registry read fails, and it carries the reason", async () => {
    const result = await verify({ erc8004: registryThatFails as never });

    expect(result.status).toBe("rpc_error");
    expect(result.error).toMatch(/503/);
    // The crucial contrast: this says nothing about the agent.
    expect(result.status).not.toBe("registry_claim_missing");
  });

  it("rpc_error when the ENS read fails, not ens_record_missing", async () => {
    const result = await verify({
      readText: async () => {
        throw new Error("eth_call timed out");
      },
    });

    expect(result.status).toBe("rpc_error");
    expect(result.error).toMatch(/reading the ENS record/);
    expect(result.key).toBe(correctKey);
  });
});

/**
 * The heart of task 3.14. Each of these three mis-encodings produces a key that
 * resolves to empty — the same observation as an agent that never wrote the
 * record. What separates them from an RPC failure is that they are findings at
 * all: the read succeeded and returned nothing.
 */
describe("mis-encoded keys fail as an empty read, distinguishably from a timeout", () => {
  const misEncodings: [string, string][] = [
    [
      "wrong agent id",
      agentRegistrationKey({ chainId: SEPOLIA, registry: REGISTRY, agentId: "2" }),
    ],
    [
      "checksummed registry address",
      `agent-registration[0x0001000003aa36a7148004A818BFB912233c491871b3d84c89A494BD9e][1]`,
    ],
    [
      "zero-padded chain reference",
      `agent-registration[0x00010000040000aa36a7148004a818bfb912233c491871b3d84c89a494bd9e][1]`,
    ],
  ];

  for (const [label, wrongKey] of misEncodings) {
    it(`${label} reads empty and reports ens_record_missing`, async () => {
      expect(wrongKey, "the mis-encoding must differ from the correct key").not.toBe(
        correctKey,
      );

      // The record exists — under the *correct* key. Only the lookup is wrong.
      const result = await verify({ records: { [correctKey]: "1" } as never });
      expect(result.status).toBe("verified");

      const missed = await verify({ records: { [wrongKey]: "1" } });
      expect(missed.status).toBe("ens_record_missing");
      expect(missed.error).toBeUndefined();
    });
  }

  it("a different chain is a different key, so Base Sepolia does not verify a Sepolia record", async () => {
    const result = await verify({
      chainId: BASE_SEPOLIA,
      records: { [correctKey]: "1" },
    });
    expect(result.status).toBe("ens_record_missing");
    expect(result.chainId).toBe(BASE_SEPOLIA);
  });
});

describe("isFinding separates what we learned from what we failed to learn", () => {
  const cases: [Ensip25Status, boolean][] = [
    ["verified", true],
    ["registry_claim_missing", true],
    ["ens_record_missing", true],
    ["mismatch", true],
    ["rpc_error", false],
    ["unchecked", false],
    ["checking", false],
  ];

  for (const [status, expected] of cases) {
    it(`${status} is ${expected ? "" : "not "}a finding`, () => {
      expect(isFinding(status)).toBe(expected);
    });
  }
});

/**
 * The registration file, which is where the ENS claim actually lives. Agent0
 * parses it from the `agentURI`, and a `services` entry named `ens` is the only
 * field in the format that carries a name — see design.md D13.
 */
describe("the registration file carries the ENS claim", () => {
  it("writes the ENS name as a services entry", () => {
    const file = buildRegistrationFile({
      name: "Research",
      ensName: NAME,
      mcpEndpoint: "https://mcp.example/agent",
    });

    expect(file.type).toBe(REGISTRATION_FILE_TYPE);
    expect(claimedEnsName(file)).toBe(NAME);
    expect(file.services.map((s) => s.name)).toEqual(["ens", "mcp"]);
  });

  it("omits an endpoint that does not exist rather than writing it empty", () => {
    const file = buildRegistrationFile({ name: "Trader", ensName: NAME });

    expect(file.services.map((s) => s.name)).toEqual(["ens"]);
    // Agent0 skips an empty endpoint string anyway, so writing one would put a
    // claim in the file that no reader ever sees.
    expect(file.services.some((s) => s.endpoint === "")).toBe(false);
  });

  it("round-trips through the base64 data URI Agent0 parses", () => {
    const file = buildRegistrationFile({
      name: "Research",
      description: "Finds things",
      ensName: NAME,
      mcpEndpoint: "https://mcp.example/agent",
    });

    const uri = encodeRegistrationFileUri(file);
    expect(uri.startsWith("data:application/json;base64,")).toBe(true);
    expect(decodeRegistrationFileUri(uri)).toEqual(file);
  });

  it("returns undefined for the URI forms that carry no inline file", () => {
    // Both are stored by the registry; neither yields a registration file to a
    // reader that does not fetch. `https://` is never fetched by Agent0 at all.
    expect(decodeRegistrationFileUri("ipfs://bafy...")).toBeUndefined();
    expect(
      decodeRegistrationFileUri("https://example.com/agent.json"),
    ).toBeUndefined();
  });
});
