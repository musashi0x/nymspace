import type { Address, ChainId } from "@nymspace/core";

/**
 * The Agent0 subgraph's real shapes.
 *
 * The previous version of this file was written from `docs/07`'s conceptual
 * query and its own comment predicted it was wrong. It was: there is no
 * `RawAgentRegistration` entity, registrations do not carry a `registry`
 * address, and `claimedEnsName` is not an on-chain field.
 *
 * Corrected against `agent0lab/subgraph`'s `schema.graphql` and its mapping
 * source. Three things follow that no consumer can be written without:
 *
 *  1. `Agent.id` is `"<chainId>:<agentId>"` and the registry address appears
 *     nowhere. ENSIP 25 needs one, so it is configuration keyed by chain id —
 *     which is what `agentRegistrationKeyForAgent0Id` in `@nymspace/ens`
 *     already assumes.
 *  2. Everything a person would call the agent's identity — its name, its ENS
 *     claim, its MCP endpoint — lives in `AgentRegistrationFile`, parsed from
 *     the `agentURI`. An agent whose `agentURI` is an `https://` URL has no
 *     registration file at all, because the mapping only parses `ipfs://` and
 *     `data:application/json;base64,`. So `registrationFile` being null is a
 *     normal, common state and not an error.
 *  3. The ENS claim is `AgentRegistrationFile.ens`, populated from a
 *     `services` entry named `ens`. See design.md D13.
 *
 * Corrected against the *deployed* subgraph rather than the repository's
 * `main`, because they differ: `main` carries `AgentRegistrationFile.hasOASF`
 * and the deployed version does not, so a query written from the repository
 * fails outright with `has no field`. Introspection is refused by the indexer
 * (`no attestation: indexing_error`), so the field list here was established by
 * probing each field individually against the live endpoint. Re-probe rather
 * than re-read the repository when this next moves.
 */

//////////////////////////////////////////////////////////////////////////////
// Raw entities, as the subgraph returns them
//////////////////////////////////////////////////////////////////////////////

/** GraphQL `BigInt` and `BigDecimal` both arrive as strings. */
export type GraphBigInt = string;
export type GraphDecimal = string;

/** `AgentRegistrationFile` — the off-chain file, parsed by the mapping. */
export interface RawRegistrationFile {
  cid: string;
  name?: string | null;
  description?: string | null;
  image?: string | null;
  active?: boolean | null;
  x402Support?: boolean | null;
  supportedTrusts: string[];
  mcpEndpoint?: string | null;
  mcpVersion?: string | null;
  /**
   * `[String!]!` in the subgraph on both networks, so a file that lists no
   * tools arrives as `[]`, the same as one that lists an empty set. Optional
   * here for fixtures and evidence captured before the field was queried.
   */
  mcpTools?: string[];
  a2aEndpoint?: string | null;
  a2aVersion?: string | null;
  webEndpoint?: string | null;
  oasfEndpoint?: string | null;
  oasfSkills: string[];
  oasfDomains: string[];
  emailEndpoint?: string | null;
  /** The ENS claim, from a `services` entry named `ens`. */
  ens?: string | null;
  did?: string | null;
}

export interface RawFeedback {
  id: string;
  clientAddress: string;
  value: GraphDecimal;
  tag1?: string | null;
  tag2?: string | null;
  /** Revoked feedback stays in the index; excluding it is our job. */
  isRevoked: boolean;
  createdAt: GraphBigInt;
}

export type ValidationStatus = "PENDING" | "COMPLETED" | "EXPIRED";

export interface RawValidation {
  id: string;
  validatorAddress: string;
  /** 0-100, where 0 means pending rather than a score of zero. */
  response?: number | null;
  status: ValidationStatus;
  createdAt: GraphBigInt;
}

/** `Agent` — the on-chain entity. */
export interface RawAgent {
  /** `"<chainId>:<agentId>"`, e.g. `"11155111:123"`. */
  id: string;
  chainId: GraphBigInt;
  agentId: GraphBigInt;
  agentURI?: string | null;
  /** `"ipfs" | "https" | "http" | "unknown"` — only the first is parsed. */
  agentURIType?: string | null;
  owner: string;
  agentWallet?: string | null;
  operators: string[];
  createdAt: GraphBigInt;
  updatedAt: GraphBigInt;
  totalFeedback: GraphBigInt;
  lastActivity: GraphBigInt;
  registrationFile?: RawRegistrationFile | null;
  feedback?: RawFeedback[] | null;
  validations?: RawValidation[] | null;
}

//////////////////////////////////////////////////////////////////////////////
// Normalised shapes, as the product consumes them
//////////////////////////////////////////////////////////////////////////////

/**
 * Trust signals, with absence preserved.
 *
 * `validation` is a discriminated union rather than a number with a sentinel,
 * because no ValidationRegistry is deployed on either Sepolia network and an
 * agent with no validation data is not an agent that scored zero. A number
 * would make weighting it at zero the path of least resistance, and `docs/04`
 * forbids inventing reputation in the same breath as inventing capabilities.
 * The union makes the ranker handle `unavailable` explicitly.
 */
export type ValidationSignal =
  | { available: false; reason: "no_validation_registry" | "none_recorded" }
  | { available: true; completed: number; pending: number; meanScore?: number };

export interface AgentReputation {
  /** Revoked feedback excluded, per `docs/13_TEST_PLAN.md`. */
  feedbackCount: number;
  revokedExcluded: number;
  meanFeedbackValue?: number;
  validation: ValidationSignal;
}

/** Where a result came from. Attached to every candidate, per task 4.12. */
export interface GraphProvenance {
  provider: "agent0";
  chainId: ChainId;
  subgraphId: string;
  queriedAt: string;
}

/** The shape the UI and the ranker consume. */
export interface NormalisedAgent {
  /** The subgraph's own `"<chainId>:<agentId>"`. */
  graphAgentKey: string;
  agentId: string;
  chainId: ChainId;
  owner: Address;
  agentWallet?: Address;
  /** Null when the `agentURI` was never parseable — a normal state. */
  name?: string;
  description?: string;
  claimedEnsName?: string;
  mcpEndpoint?: string;
  /**
   * The tools the registration says its MCP server offers — a claim written by
   * the registrant, compared against a live `tools/list` by connect and never
   * shown as a finding. Absent when the registration lists none.
   */
  mcpTools?: string[];
  a2aEndpoint?: string;
  webEndpoint?: string;
  supportedTrusts: string[];
  reputation: AgentReputation;
  registrationFile?: RawRegistrationFile;
  provenance: GraphProvenance;
}
