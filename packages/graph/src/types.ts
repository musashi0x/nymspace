import type { Address, ChainId } from "@nymspace/core";

/** An ERC 8004 registry entry as Agent0 exposes it, before normalisation. */
export interface RawAgentRegistration {
  agentId: string;
  registry: Address;
  chainId: ChainId;
  owner?: Address;
  claimedEnsName?: string | null;
  endpoints?: Array<{ protocol: string; url: string | null }> | null;
}

/** Feedback and validation state, normalised for the UI. */
export interface AgentReputation {
  feedbackCount: number;
  /** Revoked feedback is excluded, per docs/13_TEST_PLAN.md. */
  revokedExcluded: true;
  validation: "none" | "pending" | "validated" | "failed";
}

/** The shape the UI consumes: every optional source field resolved. */
export interface NormalisedAgent {
  agentId: string;
  registry: Address;
  chainId: ChainId;
  claimedEnsName?: string;
  mcpEndpoint?: string;
  a2aEndpoint?: string;
  reputation: AgentReputation;
}
