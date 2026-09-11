import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { ActivityEvidence } from "./types";

/**
 * The coordination store's schema, as Drizzle tables.
 *
 * One definition, two consumers: `drizzle-kit generate` turns it into the SQL
 * migrations under `drizzle/`, and the query builder in `store.ts` types every
 * read and write against it. That is the reason for an ORM here rather than
 * hand-written SQL — the alternative keeps the shape in two places that drift,
 * and the thing that drifts silently is the one that matters, since a column
 * added without a migration fails at demo time rather than at build time.
 *
 * Every column is a coordination value. `schema.test.ts` enumerates the columns
 * Postgres actually has against {@link ALLOWED_COLUMNS}, so a `trust_score` or
 * a `permissions` column added later fails the suite until someone consciously
 * widens that list — which is the review moment the boundary needs, and the one
 * thing a comment cannot provide.
 */

export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  parentEnsName: text("parent_ens_name").notNull(),
  chainId: integer("chain_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const agents = pgTable(
  "agents",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    ensName: text("ens_name").notNull(),
    /**
     * An identifier, not an answer. The address names which account to ask
     * about; the roles it holds come from `hasRoles` on the resolver every time
     * they are needed. A `roles` column here would make the store able to
     * change a permission answer, which the capability spec forbids outright.
     */
    controllerAddress: text("controller_address").notNull(),
    erc8004AgentId: text("erc8004_agent_id"),
    erc8004Registry: text("erc8004_registry"),
    privyWalletId: text("privy_wallet_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("agents_org_slug_unique").on(t.organizationId, t.slug)],
);

/**
 * Five tracks, one row per agent.
 *
 * Separate columns rather than one status, because `docs/09` closes by
 * forbidding a global flag that hides which integration is incomplete, and task
 * 7.1 renders all five separately on the fleet card. They are independent
 * rather than a pipeline: an agent with a verified ENSIP 25 binding and no
 * wallet is not failed, it is financially unprovisioned.
 */
export const agentProvisioning = pgTable("agent_provisioning", {
  agentId: text("agent_id")
    .primaryKey()
    .references(() => agents.id, { onDelete: "cascade" }),
  ens: text("ens").notNull().default("draft"),
  erc8004: text("erc8004").notNull().default("unregistered"),
  ensip25: text("ensip25").notNull().default("unchecked"),
  graph: text("graph").notNull().default("not_indexed"),
  financial: text("financial").notNull().default("no_wallet"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * A cache, named so nobody mistakes it for authority.
 *
 * `fetched_at` is NOT NULL because a snapshot without its read time is a value
 * presented as live, which is the failure `docs/09` permits caching in order to
 * avoid.
 */
export const identitySnapshots = pgTable("identity_snapshots", {
  agentId: text("agent_id")
    .primaryKey()
    .references(() => agents.id, { onDelete: "cascade" }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  owner: text("owner").notNull(),
  resolver: text("resolver").notNull(),
  context: text("context"),
  mcpEndpoint: text("mcp_endpoint"),
  a2aEndpoint: text("a2a_endpoint"),
  webEndpoint: text("web_endpoint"),
  ensip25Status: text("ensip25_status").notNull(),
});

export const graphSnapshots = pgTable("graph_snapshots", {
  agentId: text("agent_id")
    .primaryKey()
    .references(() => agents.id, { onDelete: "cascade" }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  chainId: integer("chain_id").notNull(),
  graphAgentKey: text("graph_agent_key").notNull(),
  subgraphId: text("subgraph_id").notNull(),
  registrationFile: jsonb("registration_file"),
  feedbackCount: integer("feedback_count"),
  /**
   * Nullable on purpose, and asserted nullable by the schema test.
   *
   * No ValidationRegistry is deployed on either Sepolia network. A `NOT NULL
   * DEFAULT 0` here would turn "the dimension is unavailable" into "this agent
   * scored zero" — invented reputation, written to disk rather than merely
   * rendered.
   */
  validationCount: integer("validation_count"),
});

/**
 * Provider identifiers and an address.
 *
 * There is deliberately no column an authorization key or raw signing material
 * could be written to. `docs/09` says not to store it and the capability spec
 * makes it a requirement; the absence of a field is what makes obeying it the
 * path of least resistance rather than a discipline.
 */
export const financialAuthority = pgTable("financial_authority", {
  agentId: text("agent_id")
    .primaryKey()
    .references(() => agents.id, { onDelete: "cascade" }),
  privyWalletId: text("privy_wallet_id").notNull(),
  walletAddress: text("wallet_address").notNull(),
  policyId: text("policy_id"),
  policyLabel: text("policy_label"),
});

export const activityEvents = pgTable(
  "activity_events",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").references(() => agents.id, {
      onDelete: "cascade",
    }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    type: text("type").notNull(),
    status: text("status").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    actor: text("actor"),
    txHash: text("tx_hash"),
    externalId: text("external_id"),
    summary: text("summary").notNull(),
    evidence: jsonb("evidence").$type<ActivityEvidence>().notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  },
  (t) => [
    // `denied` and `failed` are first-class values, not error states to be
    // filtered out later: a denial is evidence that the control plane worked.
    check(
      "activity_events_status_check",
      sql`${t.status} in ('pending', 'success', 'denied', 'failed')`,
    ),
    check(
      "activity_events_source_check",
      sql`${t.source} in ('ens', 'erc8004', 'graph', 'privy', 'app', 'mcp')`,
    ),
    // The activity route filters by agent, source, type, and status. Four
    // filter dimensions over an append-only log is the reason this store is
    // Postgres and not a file (design.md D12).
    index("activity_events_occurred_at_idx").on(t.occurredAt.desc()),
    index("activity_events_agent_idx").on(t.agentId, t.occurredAt.desc()),
    index("activity_events_filter_idx").on(t.source, t.type, t.status),
  ],
);

/**
 * One row per page view of the public site.
 *
 * This table answers the "should the store hold this?" question differently
 * from every other one here, so the answer is written down rather than left to
 * be inferred. Every other table is a *coordination* record about something an
 * external system adjudicates — ENS owns permissions, the ERC 8004 registry
 * owns identity, Privy owns policy, and the store must never be able to change
 * one of their answers. Traffic has no external authority. Nothing else knows
 * how many people opened the page, so this table is not a cache of a truth
 * held elsewhere; it *is* the record.
 *
 * What is deliberately not here:
 *
 * `user_agent` is classified into {@link pageViews.isBot} at write time and
 * then discarded. Keeping the raw string would allow re-classifying old rows
 * with a better bot list later, which is a real cost — but it is identifying
 * data collected from people who did not ask to be measured, in exchange for a
 * number on a marketing page. The trade is not close.
 *
 * There is no IP address and no session beyond the cookie, for the same
 * reason.
 */
export const pageViews = pgTable(
  "page_views",
  {
    id: text("id").primaryKey(),
    /**
     * A random id in a first-party cookie. Not an identity: clearing cookies
     * makes a returning reader a new one, and a client that sends no cookies is
     * new on every request. That is why the site says "visitors" is a lower
     * bound on people and an upper bound on nothing.
     */
    visitorId: text("visitor_id").notNull(),
    path: text("path").notNull(),
    /**
     * Classified from the user agent at write time, then the agent string is
     * dropped. Stored rather than filtered out entirely so the site can say how
     * many it excluded — a filter whose effect cannot be seen is a claim.
     */
    isBot: boolean("is_bot").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("page_views_created_at_idx").on(t.createdAt.desc()),
    // The two displayed numbers are one aggregate over this table, and both
    // filter on is_bot.
    index("page_views_visitor_idx").on(t.visitorId, t.isBot),
  ],
);

/** Every table, for the migrator and for the drift check in `schema.test.ts`. */
export const tables = {
  organizations,
  agents,
  agentProvisioning,
  identitySnapshots,
  graphSnapshots,
  financialAuthority,
  activityEvents,
  pageViews,
} as const;

//////////////////////////////////////////////////////////////////////////////
// The boundary, as a second list a human maintains
//////////////////////////////////////////////////////////////////////////////

/**
 * Every column the store is allowed to have, by table.
 *
 * Deliberately hand-written rather than derived from the Drizzle tables above.
 * Derived, it would assert that the schema equals itself and catch nothing;
 * written out, it is a second opinion that someone has to edit on purpose. That
 * edit is the review moment where "should the store hold this?" gets asked, and
 * it is the machine-checkable half of "the store coordinates and does not
 * adjudicate".
 *
 * The drift check between this and the Drizzle definition is a separate test.
 */
export const ALLOWED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  organizations: [
    "id",
    "display_name",
    "parent_ens_name",
    "chain_id",
    "created_at",
  ],
  agents: [
    "id",
    "organization_id",
    "slug",
    "ens_name",
    "controller_address",
    "erc8004_agent_id",
    "erc8004_registry",
    "privy_wallet_id",
    "created_at",
    "updated_at",
  ],
  agent_provisioning: [
    "agent_id",
    "ens",
    "erc8004",
    "ensip25",
    "graph",
    "financial",
    "updated_at",
  ],
  identity_snapshots: [
    "agent_id",
    "fetched_at",
    "owner",
    "resolver",
    "context",
    "mcp_endpoint",
    "a2a_endpoint",
    "web_endpoint",
    "ensip25_status",
  ],
  graph_snapshots: [
    "agent_id",
    "fetched_at",
    "chain_id",
    "graph_agent_key",
    "subgraph_id",
    "registration_file",
    "feedback_count",
    "validation_count",
  ],
  financial_authority: [
    "agent_id",
    "privy_wallet_id",
    "wallet_address",
    "policy_id",
    "policy_label",
  ],
  page_views: [
    "id",
    "visitor_id",
    "path",
    "is_bot",
    "created_at",
  ],
  activity_events: [
    "id",
    "agent_id",
    "organization_id",
    "source",
    "type",
    "status",
    "occurred_at",
    "actor",
    "tx_hash",
    "external_id",
    "summary",
    "evidence",
    "metadata",
  ],
} as const;

/**
 * Every table that must carry a read time, and the column carrying it.
 *
 * Separate from {@link ALLOWED_COLUMNS} because it asserts a different thing:
 * not that the column is permitted, but that it is present and `NOT NULL`. A
 * nullable `fetched_at` would let a snapshot be written without one, and a
 * snapshot with no read time is indistinguishable from a live read by the time
 * it reaches the interface.
 */
export const SNAPSHOT_TABLES = [
  "identity_snapshots",
  "graph_snapshots",
] as const;

/**
 * Substrings that must not appear in any column name.
 *
 * Weaker than the allowlist and kept anyway, because it fails with a message
 * that names the *reason* rather than merely reporting an unexpected column. A
 * contributor who adds `trust_score` learns which rule they crossed.
 */
export const FORBIDDEN_COLUMN_SUBSTRINGS = [
  "private_key",
  "privatekey",
  "secret",
  "signing_key",
  "authorization_key",
  "mnemonic",
  "seed_phrase",
  "trust_score",
  "reputation_score",
  "permission",
  "has_role",
  "role_bitmap",
  "is_allowed",
  "can_write",
] as const;
