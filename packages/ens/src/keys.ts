import { encodeInteroperableAddress, type Address, type ChainId } from "@nymspace/core";

/**
 * ENSIP 25 and ENSIP 26 record-key construction, plus DNS name encoding.
 * Pure string work — no chain access, no secrets.
 */

/**
 * DNS wire encoding of a name, the input form ENSv2's `authorizeTextRoles`
 * takes. `research.agents.eth` becomes
 * `0x08research06agents03eth00` in length-prefixed labels.
 */
export function encodeDnsName(name: string): `0x${string}` {
  const labels = name.split(".").filter((label) => label.length > 0);
  let out = "0x";

  for (const label of labels) {
    const bytes = new TextEncoder().encode(label);
    if (bytes.length > 63) {
      throw new Error(`DNS label exceeds 63 bytes: ${label}`);
    }
    out += bytes.length.toString(16).padStart(2, "0");
    for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  }

  return `${out}00` as `0x${string}`;
}

/**
 * Canonicalize an agent identifier for use inside an ENSIP 25 key.
 *
 * The key is hashed into an EAC resource, so `167` and `0167` are two different
 * records and only one of them is the one anybody else will look up. ENSIP 25
 * forbids `[` and `]` in the identifier; everything else here is Nymspace
 * narrowing the space to what ERC 8004 actually issues, which is a decimal
 * counter.
 */
export function canonicalAgentId(agentId: string | number | bigint): string {
  const raw = String(agentId).trim();

  if (raw.includes("[") || raw.includes("]")) {
    throw new Error(`ENSIP 25 forbids [ and ] in an agent id: ${raw}`);
  }
  if (!/^(0x)?[0-9a-fA-F]+$/.test(raw)) {
    throw new Error(`Agent id is not a number: ${raw}`);
  }

  // A `0x` prefix means hex; a bare digit string is decimal, even when every
  // character happens to be a hex digit.
  const value = raw.startsWith("0x") ? BigInt(raw) : BigInt(raw.replace(/^0+(?=\d)/, ""));
  return value.toString(10);
}

/**
 * The ENSIP 25 parameterised key, `agent-registration[<registry>][<agentId>]`.
 *
 * `<registry>` is the ERC 7930 interoperable address of the registry contract
 * as a lowercase `0x` hex string. There is no text-form alternative: ENSIP 25
 * says hex, and a key built any other way resolves to empty, which is
 * indistinguishable from an honest "not verified".
 *
 * The published example renders as `[ 0x… ][ 167 ]`; those spaces are an HTML
 * artifact of the docs site and a copy-pasted key carrying them is wrong, so
 * the result is checked for whitespace before it is returned.
 */
export function agentRegistrationKey(params: {
  chainId: ChainId;
  registry: Address;
  agentId: string | number | bigint;
}): string {
  const { chainId, registry } = params;

  // viem's getAddress() returns EIP-55 mixed case; interpolating that produces
  // a valid-looking key that resolves to empty. encodeInteroperableAddress
  // lowercases, and this asserts it stayed that way.
  const encoded = encodeInteroperableAddress(chainId, registry);
  if (encoded !== encoded.toLowerCase()) {
    throw new Error(`Registry component must be lowercase hex: ${encoded}`);
  }

  const key = `agent-registration[${encoded}][${canonicalAgentId(params.agentId)}]`;
  if (/\s/.test(key)) {
    throw new Error(`ENSIP 25 key contains whitespace: ${JSON.stringify(key)}`);
  }
  return key;
}

/**
 * Agent0 returns `Agent.id` as `<chainId>:<agentId>` and never returns the
 * registry address, while ENSIP 25 needs one. So the registry is a trusted
 * local input keyed by chain id — configuration, not discovery — and this is
 * the only place the two identifier schemes meet.
 */
export type RegistryByChainId = Readonly<Record<number, Address>>;

/** Split an Agent0 `Agent.id` (`11155111:7`) into its parts. */
export function parseAgent0Id(id: string): { chainId: ChainId; agentId: string } {
  const [chain, agent, ...rest] = id.split(":");
  if (rest.length > 0 || !chain || !agent) {
    throw new Error(`Not an Agent0 id of the form <chainId>:<agentId>: ${id}`);
  }
  const chainId = Number(chain);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error(`Agent0 id carries a bad chain id: ${id}`);
  }
  return { chainId, agentId: canonicalAgentId(agent) };
}

/** Build the ENSIP 25 key straight from an Agent0 id and a configured table. */
export function agentRegistrationKeyForAgent0Id(
  id: string,
  registries: RegistryByChainId,
): string {
  const { chainId, agentId } = parseAgent0Id(id);
  const registry = registries[chainId];
  if (!registry) {
    throw new Error(
      `No ERC 8004 identity registry configured for chain ${chainId}. ` +
        `Agent0 does not return one, so it must come from configuration.`,
    );
  }
  return agentRegistrationKey({ chainId, registry, agentId });
}

/** The ENSIP 26 endpoint key for a named protocol, e.g. `agent-endpoint[mcp]`. */
export function agentEndpointKey(protocol: "mcp" | "a2a"): string {
  return `agent-endpoint[${protocol}]`;
}

/** The ENSIP 26 free-text context key. */
export const AGENT_CONTEXT_KEY = "agent-context";

/**
 * ENSIP 25 registry-to-ENS verification.
 *
 * Takes the claimed name, agent id, and registry from a registry entry,
 * constructs the key, resolves it, and treats any non-empty value as verified.
 * The value itself carries no meaning — ENSIP 25 says clients MUST NOT depend
 * on it beyond being non-empty.
 *
 * `verifiedAt` is not decoration. ENSIP 25's own security note is that a name
 * transfer can leave a stale attestation behind, so a verification result is
 * only true as of the moment it was read.
 */
export interface VerificationResult {
  verified: boolean;
  key: string;
  value: string;
  verifiedAt: string;
}

export async function verifyAgentRegistration(params: {
  name: string;
  chainId: ChainId;
  registry: Address;
  agentId: string | number | bigint;
  readText: (name: string, key: string) => Promise<string>;
}): Promise<VerificationResult> {
  const key = agentRegistrationKey({
    chainId: params.chainId,
    registry: params.registry,
    agentId: params.agentId,
  });

  const value = await params.readText(params.name, key);
  return {
    verified: value.length > 0,
    key,
    value,
    verifiedAt: new Date().toISOString(),
  };
}
