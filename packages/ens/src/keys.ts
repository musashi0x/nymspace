import {
  encodeInteroperableAddress,
  type Address,
  type ChainId,
} from "@nymspace/core";

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
 * The ENSIP 25 parameterised key, `agent-registration[<registry>][<agentId>]`,
 * where the registry component is an ERC 7930 interoperable address.
 *
 * ENSIP 25 is a draft and does not pin whether the registry component is the
 * binary form or the text form. The Day 1 spike settles it against the
 * deployed resolver; `registryForm` exists so that switching is one argument
 * rather than a rewrite.
 */
export function agentRegistrationKey(params: {
  chainId: ChainId;
  registry: Address;
  agentId: string;
  registryForm?: "binary" | "text";
}): string {
  const { chainId, registry, agentId, registryForm = "binary" } = params;
  const encoded =
    registryForm === "binary"
      ? encodeInteroperableAddress(chainId, registry)
      : `eip155:${chainId}:${registry.toLowerCase()}`;

  return `agent-registration[${encoded}][${agentId}]`;
}

/** The ENSIP 26 endpoint key for a named protocol, e.g. `agent-endpoint[mcp]`. */
export function agentEndpointKey(protocol: "mcp" | "a2a"): string {
  return `agent-endpoint[${protocol}]`;
}

/** The ENSIP 26 free-text context key. */
export const AGENT_CONTEXT_KEY = "agent-context";
