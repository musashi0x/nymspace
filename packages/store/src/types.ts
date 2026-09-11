import type { Address, ChainId, Hex } from "@nymspace/core";

/**
 * The coordination store's entity shapes, from
 * `docs/09_DATA_AND_EVENT_MODEL.md`.
 *
 * The opening line of that document is the whole constraint: the application
 * database coordinates the product and is not the source of truth for
 * identity, trust, or policy. Everything in this file is written to make that
 * hard to violate by accident rather than merely stated in a comment — a
 * permission decision, a trust score, and key material are all unspellable in
 * these types, and `schema.test.ts` re-asserts the same thing against the
 * columns Postgres actually has, because a type is only a constraint on code
 * that goes through it.
 *
 * Pure types. No pg import, no environment read.
 */

//////////////////////////////////////////////////////////////////////////////
// Snapshots — task 2.3
//////////////////////////////////////////////////////////////////////////////

declare const SnapshotBrand: unique symbol;

/**
 * A value read from an external system, carrying the moment it was read.
 *
 * The brand is what makes task 2.3's "cannot be constructed without it"
 * literally true. A required `fetchedAt` field alone is weaker than it looks:
 * any object literal that happens to carry a `fetchedAt` string satisfies it,
 * including one where the field was copied forward from an older read. The
 * brand means the only way to obtain a `Snapshot<T>` is {@link snapshot}, which
 * stamps the time itself.
 *
 * `docs/09` allows caching and forbids treating the cache as truth. This type
 * is the difference: a cached value that reaches the interface still knows when
 * it was true, so the console can label it rather than present it as live.
 */
export type Snapshot<T> = T & {
  readonly fetchedAt: string;
  readonly [SnapshotBrand]: true;
};

/**
 * Stamp a value as read now. The one constructor for {@link Snapshot}.
 *
 * `fetchedAt` is a parameter rather than always `now` because a value read
 * inside a transaction and stored afterwards was true at the read, not at the
 * write, and the difference is exactly what a staleness label is for.
 */
export function snapshot<T extends object>(
  value: T,
  fetchedAt: string = new Date().toISOString(),
): Snapshot<T> {
  return { ...value, fetchedAt } as Snapshot<T>;
}

/** True when a snapshot is older than `maxAgeMs`, as of `now`. */
export function isStale(
  value: Snapshot<object>,
  maxAgeMs: number,
  now: number = Date.now(),
): boolean {
  return now - Date.parse(value.fetchedAt) > maxAgeMs;
}

//////////////////////////////////////////////////////////////////////////////
// Entities
//////////////////////////////////////////////////////////////////////////////

export interface Organization {
  id: string;
  displayName: string;
  parentEnsName: string;
  chainId: ChainId;
  createdAt: string;
}

/**
 * One agent's coordination record: identifiers and labels, and nothing that
 * has an authority elsewhere.
 *
 * `controllerAddress` is here and the controller's *roles* are not. The
 * address is an identifier — it names which account to ask about — while the
 * roles are the answer, and the answer comes from `hasRoles` on the resolver
 * every time it is needed. Storing the roles would make the store able to
 * change a permission answer, which the capability spec forbids outright.
 */
export interface Agent {
  id: string;
  organizationId: string;
  slug: string;
  ensName: string;
  controllerAddress: Address;
  erc8004AgentId?: string;
  erc8004Registry?: Address;
  privyWalletId?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * ENSIP 25's verification states, all seven of them, from
 * `docs/06_AGENT_IDENTITY_STANDARDS.md`.
 *
 * The document's own instruction is not to collapse failures into
 * `unverified`, and the reason is that these states have different meanings to
 * an operator: `registry_claim_missing` says the agent never claimed the name,
 * `ens_record_missing` says the claim exists but the ENS side does not,
 * `mismatch` says both exist and disagree, and `rpc_error` says nothing about
 * the agent at all. The spike proved three distinct mis-encodings each fail as
 * an empty read, which means `ens_record_missing` is where a bug in our own key
 * construction lands — so the console must never present it as a settled fact.
 */
export type Ensip25Status =
  | "unchecked"
  | "checking"
  | "verified"
  | "registry_claim_missing"
  | "ens_record_missing"
  | "mismatch"
  | "rpc_error";

/** ENS-derived identity state, cached with its read time. */
export interface AgentIdentityFields {
  agentId: string;
  owner: Address;
  resolver: Address;
  context?: string;
  mcpEndpoint?: string;
  a2aEndpoint?: string;
  webEndpoint?: string;
  ensip25Status: Ensip25Status;
}

export type AgentIdentitySnapshot = Snapshot<AgentIdentityFields>;

/** Agent0 subgraph state, cached with its read time and its provenance. */
export interface GraphFields {
  agentId: string;
  chainId: ChainId;
  graphAgentKey: string;
  subgraphId: string;
  registrationFile: unknown;
  feedbackCount?: number;
  /**
   * Absent, never zero.
   *
   * No ValidationRegistry is deployed on either Sepolia network, and an agent
   * with no validation data is not an agent that failed validation. `docs/04`
   * forbids inventing reputation in the same breath as inventing capabilities,
   * so the optionality here is load-bearing: `undefined` means the dimension is
   * unavailable and the trust panel drops the row.
   */
  validationCount?: number;
}

export type GraphSnapshot = Snapshot<GraphFields>;

/**
 * The financial authority reference: provider identifiers and an address.
 *
 * There is deliberately no field an authorization key or raw signing material
 * could go in. `docs/09` says not to store it and the capability spec makes it
 * a requirement; this shape is what makes obeying it the path of least
 * resistance rather than a discipline.
 */
export interface FinancialAuthorityRef {
  agentId: string;
  privyWalletId: string;
  walletAddress: Address;
  policyId?: string;
  policyLabel?: string;
}

//////////////////////////////////////////////////////////////////////////////
// Provisioning — task 2.4
//////////////////////////////////////////////////////////////////////////////

/**
 * Five independent tracks, one per integration, because `docs/09` closes with
 * the instruction not to force one global `active` status that hides which
 * integration is incomplete — and because task 7.1 renders exactly these five
 * separately on the fleet card.
 *
 * They are independent rather than a pipeline: an agent with a verified ENSIP
 * 25 binding and no wallet is not failed, it is financially unprovisioned, and
 * an agent whose Graph indexing is pending is still fully usable for every
 * identity proof. A single enum spanning all five could not say either thing.
 */
export type EnsProvisioning = "draft" | "pending" | "active" | "failed";

export type Erc8004Provisioning =
  | "unregistered"
  | "pending"
  | "registered"
  | "failed";

export type GraphProvisioning =
  | "not_indexed"
  | "pending"
  | "indexed"
  | "provider_error";

export type FinancialProvisioning =
  | "no_wallet"
  | "wallet_created"
  | "policy_configured"
  | "financially_active"
  | "failed";

export interface ProvisioningStatus {
  ens: EnsProvisioning;
  erc8004: Erc8004Provisioning;
  /** The verification track. Reuses ENSIP 25's own seven states. */
  ensip25: Ensip25Status;
  graph: GraphProvisioning;
  financial: FinancialProvisioning;
}

export const INITIAL_PROVISIONING: ProvisioningStatus = {
  ens: "draft",
  erc8004: "unregistered",
  ensip25: "unchecked",
  graph: "not_indexed",
  financial: "no_wallet",
};

/** An agent with its five tracks attached, as the fleet screen reads it. */
export interface AgentWithProvisioning extends Agent {
  provisioning: ProvisioningStatus;
}

//////////////////////////////////////////////////////////////////////////////
// Activity — task 2.2
//////////////////////////////////////////////////////////////////////////////

export type ActivitySource = "ens" | "erc8004" | "graph" | "privy" | "app" | "mcp";

export type ActivityStatus = "pending" | "success" | "denied" | "failed";

export type ActivityType =
  | "agent.created"
  | "ens.resolver.attached"
  | "ens.permission.granted"
  | "ens.permission.revoked"
  | "ens.record.updated"
  | "ens.action.denied"
  | "erc8004.registered"
  | "ensip25.verified"
  | "ensip25.failed"
  | "graph.indexed"
  | "graph.discovery.executed"
  | "privy.wallet.created"
  | "privy.payment.executed"
  | "privy.payment.denied"
  | "privy.approval.requested"
  | "mcp.connect.succeeded"
  | "mcp.connect.failed"
  | "mcp.connect.blocked";

/**
 * Per-source evidence, as a discriminated union rather than a bag of optional
 * fields.
 *
 * The capability spec requires an ENS event to carry a transaction hash, a
 * Graph event to carry chain, subgraph id, and query time, and a financial
 * event to carry a request id or a transaction hash. Written as optionals on
 * one shape, every one of those requirements would be a convention. Written as
 * a union keyed on `source`, an ENS event with no transaction hash does not
 * typecheck, and {@link assertEvidence} re-checks it at the write boundary for
 * the callers that arrive with data from outside the type system.
 */
export type ActivityEvidence =
  | {
      source: "ens";
      txHash: Hex;
      contractAddress: Address;
      blockNumber?: string;
    }
  | {
      source: "erc8004";
      txHash: Hex;
      contractAddress: Address;
      chainId: ChainId;
      blockNumber?: string;
    }
  | {
      source: "graph";
      chainId: ChainId;
      subgraphId: string;
      queriedAt: string;
      graphEntityId?: string;
    }
  | {
      source: "privy";
      /** At least one of these is required; {@link assertEvidence} enforces it. */
      requestId?: string;
      txHash?: Hex;
      policyDecision?: string;
    }
  | {
      source: "app";
    }
  | {
      /**
       * An outbound MCP connect: a read of somebody else's endpoint, so none
       * of the sources above describes it. `app` is this application's own
       * actions, and a claim about a third-party server does not belong there.
       */
      source: "mcp";
      /** Null for `no_endpoint`: nothing was published, so nothing was dialled. */
      endpoint: string | null;
      /** Which system published the endpoint. */
      endpointSource: "ens" | "graph";
      /** The connect outcome, e.g. `connected`, `blocked`, `timeout`. */
      outcome: string;
      readAt: string;
    };

export interface ActivityEvent {
  id: string;
  agentId?: string;
  organizationId: string;
  source: ActivitySource;
  type: ActivityType;
  status: ActivityStatus;
  occurredAt: string;
  actor?: Address;
  txHash?: Hex;
  externalId?: string;
  summary: string;
  evidence: ActivityEvidence;
  metadata?: Record<string, unknown>;
}

/** What a caller supplies; the store assigns the id. */
export type NewActivityEvent = Omit<ActivityEvent, "id"> & { id?: string };

/**
 * Runtime evidence validation, for values that did not come through the union.
 *
 * A route handler builds an event from a provider response, and a provider
 * response is `unknown` however carefully the surrounding code is typed. This
 * is the boundary check that makes the spec's "evidence matches the source"
 * requirement hold for those callers too.
 */
export function assertEvidence(
  source: ActivitySource,
  evidence: ActivityEvidence,
): void {
  if (evidence.source !== source) {
    throw new Error(
      `Activity evidence is for ${evidence.source} but the event's source is ${source}`,
    );
  }

  switch (evidence.source) {
    case "ens":
    case "erc8004":
      if (!evidence.txHash) {
        throw new Error(`A ${source} event must carry a transaction hash`);
      }
      return;
    case "graph":
      if (!evidence.subgraphId || !evidence.queriedAt) {
        throw new Error(
          "A graph event must carry the chain, the subgraph id, and the query time",
        );
      }
      return;
    case "mcp":
      // `endpoint` may be null, never missing: null is the recorded fact that
      // nothing was published, and undefined would be the absence of a record.
      if (
        evidence.endpoint === undefined ||
        (evidence.endpointSource !== "ens" && evidence.endpointSource !== "graph") ||
        !evidence.outcome ||
        !evidence.readAt
      ) {
        throw new Error(
          "An mcp event must carry the endpoint, the source that published it, the outcome, and the read time",
        );
      }
      return;
    case "privy":
      // Either identifier is acceptable: a denied payment never reaches a
      // chain and so has no transaction hash, and refusing to record it would
      // discard the evidence that the control plane worked.
      if (!evidence.requestId && !evidence.txHash) {
        throw new Error(
          "A privy event must carry a request identifier or a transaction hash",
        );
      }
      return;
    case "app":
      return;
  }
}

//////////////////////////////////////////////////////////////////////////////
// Query surface
//////////////////////////////////////////////////////////////////////////////

/** Filters for the activity route, from `docs/10_API_CONTRACT.md`. */
export interface ActivityFilter {
  /**
   * Scope to one organization.
   *
   * Not cosmetic. The store is multi-tenant by design — `Organization` is an
   * entity and agents hang off it — so an unscoped timeline query returns every
   * organization's events. Found by a test that asserted a count and got the
   * provisioning run's events too.
   */
  organizationId?: string;
  agentId?: string;
  source?: ActivitySource;
  type?: ActivityType;
  status?: ActivityStatus;
  limit?: number;
}

//////////////////////////////////////////////////////////////////////////////
// Site traffic
//////////////////////////////////////////////////////////////////////////////

/**
 * The two numbers the public site shows, plus the one that makes them
 * readable.
 *
 * `botViews` exists because a bot filter whose effect cannot be seen is a
 * claim rather than a measurement. Showing "excluded N automated requests"
 * next to the totals is what lets a reader judge whether the filter is doing
 * anything, and it is the difference between a number and a number you can
 * argue with.
 */
export interface PageViewStats {
  /** Rows where `is_bot` is false. */
  views: number;
  /** Distinct visitor ids among those rows. */
  visitors: number;
  /** Rows excluded as automated. Not part of `views`. */
  botViews: number;
  /**
   * When counting started — the oldest row, bot or not. Null when nothing has
   * been recorded yet. Totals with no start date read as all-time and are not.
   */
  since: string | null;
}
