/**
 * The Agent Inspector response contract.
 *
 * This is the shape `GET /v1/agents/:name/snapshot` returns and the shape the
 * Inspector UI renders. It is deliberately shared: the API produces it, the web
 * app consumes it, and neither owns a private copy.
 *
 * Three properties of the ENSv2 authority model, all confirmed on Sepolia by
 * the Day 1 spike (`openspec/specs/ensv2-authority/spec.md`), drove the design:
 *
 * 1. A permission is not a boolean. `onlyPartRoles` accepts a grant at
 *    `resource(node, part)`, `resource(0, part)` or `resource(node, 0)`, and
 *    `hasRoles` additionally ORs in the account's ROOT_RESOURCE roles. A
 *    name-wide, wildcard or root grant authorises a key with no per-key grant
 *    event, so a UI that enumerates per-key grants alone under-reports. Every
 *    check therefore carries the scope it was satisfied at.
 * 2. A failed read is not a denial. An RPC timeout rendered as "Denied" is a
 *    lie about the contract's state, so `unknown` is a first-class value and is
 *    never collapsed into `denied`.
 * 3. The registry and the resolver are separate EAC domains, and registry
 *    ownership confers no resolver authority. Every check names the contract
 *    that answered it.
 */

import type { Address, ChainId, Hex } from "./types";

/**
 * The EAC scope a permission was satisfied at. Ordered widest-last, because the
 * UI surfaces the widest scope as the thing worth questioning.
 *
 * - `record`   `resource(namehash, partHash(key))` — this key, on this name.
 * - `name`     `resource(namehash, 0)` — every key on this name.
 * - `wildcard` `resource(0, partHash(key))` — this key on EVERY name the
 *              resolver serves. The spike forbids ever granting this; if one is
 *              ever observed the UI must show it as a finding, not a checkmark.
 * - `root`     ROOT_RESOURCE, OR'd in by `hasRoles`. How the organization holds
 *              authority over subnames it has not been granted individually.
 */
export type PermissionScope = "record" | "name" | "wildcard" | "root";

/**
 * Tri-state on purpose. `unknown` means the chain was not successfully read —
 * it must render differently from `denied` and must never be reported as one.
 */
export type PermissionState = "allowed" | "denied" | "unknown";

/** Which EAC domain answered. These do not bridge; see note 3 above. */
export type AuthorityDomain = "registry" | "resolver";

export interface PermissionCheck {
  state: PermissionState;
  /** Present only when `state` is `allowed` — where the authority came from. */
  scope?: PermissionScope;
  /** Present only when `state` is `unknown` — why the read did not complete. */
  unavailableReason?: string;
  /** The EAC resource actually queried, so a reader can replay the call. */
  resource: Hex;
  /** The contract that answered. */
  domain: AuthorityDomain;
}

/**
 * Capabilities the Inspector renders as rows. The set matches the policy table
 * in `docs/03_UX_SPEC.md`; the *values* are always live reads, never constants.
 */
export type AgentCapability =
  | "record:agent-context"
  | "record:agent-endpoint[mcp]"
  | "record:agent-endpoint[a2a]"
  | "record:agent-registration"
  | "registry:setResolver"
  | "registry:setSubregistry"
  | "registry:transfer";

/** One row of the permission matrix: one capability, both actors. */
export interface CapabilityRow {
  capability: AgentCapability;
  /** Human label, resolved server-side so the UI holds no policy copy. */
  label: string;
  domain: AuthorityDomain;
  controller: PermissionCheck;
  organization: PermissionCheck;
}

/** Chain-derived identity fields. `null` means absent, not unread. */
export interface AgentIdentity {
  /** Normalised full ENS name, e.g. `research.nymspace.eth`. */
  name: string;
  parent: string;
  owner: Address | null;
  controller: Address | null;
  resolver: Address | null;
  registry: Address | null;
}

/**
 * ENS records as read through resolution. ENS is the source; this is not a
 * profile in a database. A key absent from the map was read and found empty; a
 * key in `unreadable` failed its read.
 */
export interface AgentRecords {
  values: Partial<Record<string, string>>;
  unreadable: string[];
}

/**
 * ENSIP 25 association state.
 *
 * `verified` is only ever set by a runtime check that passed, per task #84.
 * ENSIP 25's own security note is why `checkedAt` is not evidence of anything
 * on its own: re-reading an unchanged record gives a new observation time, not
 * a fresh endorsement from a new owner. If ownership or the resolver has moved
 * since, the association is `stale` and must be re-attested, not re-timestamped.
 */
export type Ensip25Status =
  | {
      status: "verified";
      registry: Address;
      chainId: ChainId;
      agentId: string;
      checkedAt: string;
    }
  | { status: "unverified"; reason: string }
  | { status: "stale"; reason: string; previouslyVerifiedAt?: string }
  | { status: "unavailable"; reason: string };

/** Everything needed to replay the reads behind this snapshot. */
export interface ReadProvenance {
  chainId: ChainId;
  /** Stringified — a block number does not survive JSON as a bigint. */
  blockNumber: string;
  readAt: string;
  contracts: {
    registry: Address | null;
    resolver: Address | null;
  };
}

/** `GET /v1/agents/:name/snapshot` */
export interface AgentSnapshot {
  identity: AgentIdentity;
  records: AgentRecords;
  authority: CapabilityRow[];
  ensip25: Ensip25Status;
  provenance: ReadProvenance;
}

/**
 * Outcome of the permission proof (`Run permission proof` in the UX spec).
 *
 * `inconclusive` exists because of a real bug the spike hit: a `checkReverts`
 * helper that caught every exception and marked it passed, so an RPC timeout or
 * an unfunded account was indistinguishable from EAC actually enforcing. A
 * denial only counts when the contract's own error says so — anything else is
 * inconclusive and must not be presented as proof of the boundary.
 */
export type ProofOutcome =
  | {
      result: "allowed";
      txHash: Hex;
      blockNumber: string;
      /** The value read back after the receipt confirmed. */
      readBack: string;
    }
  | {
      result: "denied_by_eac";
      /** The decoded custom error, e.g. `Unauthorized(...)`. */
      decodedError: string;
      /** True when the denial came from simulation rather than a mined revert. */
      simulated: boolean;
    }
  | {
      result: "inconclusive";
      /** Transport, funding, or nonce trouble — never a permission verdict. */
      reason: string;
    };

/** `POST /v1/agents/:name/proof` */
export interface ProofRequest {
  /** Which capability to exercise. */
  capability: AgentCapability;
  /** Which key to sign as. The server holds both; the browser holds neither. */
  actor: "controller" | "organization";
  /** Only for record writes — the value to attempt. */
  value?: string;
}

export interface ProofResponse {
  capability: AgentCapability;
  actor: "controller" | "organization";
  outcome: ProofOutcome;
  provenance: ReadProvenance;
}
