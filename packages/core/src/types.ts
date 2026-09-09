/**
 * Shared domain types. Pure — no secrets, no runtime dependencies, importable
 * from server and client alike.
 */

/** A 0x-prefixed, 20-byte EVM address. */
export type Address = `0x${string}`;

/** A 0x-prefixed hex string of arbitrary length. */
export type Hex = `0x${string}`;

/** An EIP-155 chain id. */
export type ChainId = number;

/**
 * The record keys Nymspace delegates through ENSIP 26 text records.
 * `agent-registration[...]` is parameterised and so is not enumerated here.
 */
export const AGENT_TEXT_KEYS = [
  "agent-context",
  "agent-endpoint[mcp]",
  "agent-endpoint[a2a]",
] as const;

export type AgentTextKey = (typeof AGENT_TEXT_KEYS)[number];

/**
 * Live permission state for one controller over one agent name, as read from
 * chain. Per docs/05_ENSV2_IMPLEMENTATION.md these are never derived from a
 * local flag — every value is a chain read.
 */
export interface AgentPermissions {
  controller: Address;
  /** Per text-record-key write permission, keyed by the full ENSIP 26 key. */
  records: Record<string, boolean>;
  /** Name-scoped registry permissions. */
  registry: {
    setResolver: boolean;
    setSubregistry: boolean;
    unregister: boolean;
  };
}

/**
 * The Agent Manifest — a UX representation of standardised ENS records plus
 * linked registry state, not an authoritative object of its own.
 * See docs/06_AGENT_IDENTITY_STANDARDS.md.
 */
export interface AgentManifest {
  name: string;
  context?: string;
  endpoints: {
    mcp?: string;
    a2a?: string;
  };
  registration?: {
    registry: Address;
    chainId: ChainId;
    agentId: string;
    /** True when the ENSIP 25 key resolves to a non-empty value. */
    ensAssociationVerified: boolean;
  };
}
