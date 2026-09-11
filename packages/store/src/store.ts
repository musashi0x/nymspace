import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { Address, ChainId, Hex } from "@nymspace/core";
import { database, type Database } from "./db";
import {
  activityEvents,
  agentProvisioning,
  agents,
  financialAuthority,
  graphSnapshots,
  identitySnapshots,
  organizations,
  pageViews,
} from "./schema";
import {
  assertEvidence,
  snapshot,
  INITIAL_PROVISIONING,
  type ActivityEvent,
  type ActivityEvidence,
  type ActivityFilter,
  type ActivitySource,
  type ActivityStatus,
  type ActivityType,
  type Agent,
  type AgentIdentityFields,
  type AgentIdentitySnapshot,
  type AgentWithProvisioning,
  type Ensip25Status,
  type FinancialAuthorityRef,
  type GraphFields,
  type GraphSnapshot,
  type NewActivityEvent,
  type Organization,
  type PageViewStats,
  type ProvisioningStatus,
} from "./types";

/**
 * The coordination store.
 *
 * Reads and writes identifiers, labels, provisioning progress, cached
 * snapshots, and the activity log. It cannot answer an authority question —
 * there is no method here that returns a permission, a role, or a trust score,
 * because those come from a contract read every time they are needed and the
 * capability spec requires that the store be unable to change the answer.
 *
 * Takes a database handle rather than reading the environment, so a test
 * constructs its own connection instead of arranging process state before an
 * import that has already hoisted.
 */
export class Store {
  private readonly db: Database;

  constructor(db: Database = database()) {
    this.db = db;
  }

  //////////////////////////////////////////////////////////////////////////
  // Organization
  //////////////////////////////////////////////////////////////////////////

  async upsertOrganization(
    org: Omit<Organization, "createdAt"> & { createdAt?: string },
  ): Promise<Organization> {
    const [row] = await this.db
      .insert(organizations)
      .values({
        id: org.id,
        displayName: org.displayName,
        parentEnsName: org.parentEnsName,
        chainId: org.chainId,
      })
      .onConflictDoUpdate({
        target: organizations.id,
        set: {
          displayName: org.displayName,
          parentEnsName: org.parentEnsName,
          chainId: org.chainId,
        },
      })
      .returning();

    return toOrganization(row!);
  }

  async getOrganization(id: string): Promise<Organization | undefined> {
    const [row] = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, id));
    return row ? toOrganization(row) : undefined;
  }

  //////////////////////////////////////////////////////////////////////////
  // Agents
  //////////////////////////////////////////////////////////////////////////

  /**
   * Create or update an agent, and ensure it has a provisioning row.
   *
   * One transaction, because an agent with no provisioning row would read as
   * five absent tracks — which the fleet screen cannot tell apart from five
   * unstarted ones, and "we do not know" and "not begun" are different answers
   * to give an operator.
   *
   * The optional identifiers coalesce rather than overwrite. Provisioning
   * arrives in stages, and a later ENS update that carried no wallet id must
   * not erase the wallet id an earlier Privy step recorded.
   */
  async upsertAgent(
    agent: Omit<Agent, "createdAt" | "updatedAt">,
  ): Promise<Agent> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(agents)
        .values({
          id: agent.id,
          organizationId: agent.organizationId,
          slug: agent.slug,
          ensName: agent.ensName,
          controllerAddress: agent.controllerAddress,
          erc8004AgentId: agent.erc8004AgentId ?? null,
          erc8004Registry: agent.erc8004Registry ?? null,
          privyWalletId: agent.privyWalletId ?? null,
        })
        .onConflictDoUpdate({
          target: agents.id,
          set: {
            // Written on conflict, not just on insert. Leaving it out loses the
            // caller's value silently: an id that already exists under another
            // organization keeps the old one, the upsert reports success, and
            // the agent then vanishes from `listAgents` for the organization
            // that just created it. Found exactly that way.
            organizationId: agent.organizationId,
            slug: agent.slug,
            ensName: agent.ensName,
            controllerAddress: agent.controllerAddress,
            erc8004AgentId: sql`coalesce(excluded.erc8004_agent_id, ${agents.erc8004AgentId})`,
            erc8004Registry: sql`coalesce(excluded.erc8004_registry, ${agents.erc8004Registry})`,
            privyWalletId: sql`coalesce(excluded.privy_wallet_id, ${agents.privyWalletId})`,
            updatedAt: new Date(),
          },
        })
        .returning();

      await tx
        .insert(agentProvisioning)
        .values({ agentId: agent.id, ...INITIAL_PROVISIONING })
        .onConflictDoNothing();

      return toAgent(row!);
    });
  }

  async getAgent(id: string): Promise<AgentWithProvisioning | undefined> {
    const [row] = await this.db
      .select()
      .from(agents)
      .leftJoin(agentProvisioning, eq(agentProvisioning.agentId, agents.id))
      .where(eq(agents.id, id));
    return row ? toAgentWithProvisioning(row) : undefined;
  }

  async getAgentBySlug(
    organizationId: string,
    slug: string,
  ): Promise<AgentWithProvisioning | undefined> {
    const [row] = await this.db
      .select()
      .from(agents)
      .leftJoin(agentProvisioning, eq(agentProvisioning.agentId, agents.id))
      .where(
        and(eq(agents.organizationId, organizationId), eq(agents.slug, slug)),
      );
    return row ? toAgentWithProvisioning(row) : undefined;
  }

  async listAgents(organizationId: string): Promise<AgentWithProvisioning[]> {
    const rows = await this.db
      .select()
      .from(agents)
      .leftJoin(agentProvisioning, eq(agentProvisioning.agentId, agents.id))
      .where(eq(agents.organizationId, organizationId))
      .orderBy(agents.slug);
    return rows.map(toAgentWithProvisioning);
  }

  /**
   * Advance one or more tracks.
   *
   * Partial by construction, so moving the ENS track cannot silently reset the
   * financial one — the mistake a single status column makes impossible to
   * avoid rather than merely easy to make.
   */
  async setProvisioning(
    agentId: string,
    patch: Partial<ProvisioningStatus>,
  ): Promise<ProvisioningStatus> {
    const [row] = await this.db
      .update(agentProvisioning)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(agentProvisioning.agentId, agentId))
      .returning();

    if (!row) throw new Error(`No provisioning row for agent ${agentId}`);
    return toProvisioning(row);
  }

  //////////////////////////////////////////////////////////////////////////
  // Snapshots — caches, and labelled as such
  //////////////////////////////////////////////////////////////////////////

  async putIdentitySnapshot(
    value: AgentIdentitySnapshot,
  ): Promise<AgentIdentitySnapshot> {
    const row = {
      agentId: value.agentId,
      fetchedAt: new Date(value.fetchedAt),
      owner: value.owner,
      resolver: value.resolver,
      context: value.context ?? null,
      mcpEndpoint: value.mcpEndpoint ?? null,
      a2aEndpoint: value.a2aEndpoint ?? null,
      webEndpoint: value.webEndpoint ?? null,
      ensip25Status: value.ensip25Status,
    };

    await this.db
      .insert(identitySnapshots)
      .values(row)
      .onConflictDoUpdate({ target: identitySnapshots.agentId, set: row });

    return value;
  }

  async getIdentitySnapshot(
    agentId: string,
  ): Promise<AgentIdentitySnapshot | undefined> {
    const [row] = await this.db
      .select()
      .from(identitySnapshots)
      .where(eq(identitySnapshots.agentId, agentId));
    if (!row) return undefined;

    const fields: AgentIdentityFields = {
      agentId: row.agentId,
      owner: row.owner as Address,
      resolver: row.resolver as Address,
      context: row.context ?? undefined,
      mcpEndpoint: row.mcpEndpoint ?? undefined,
      a2aEndpoint: row.a2aEndpoint ?? undefined,
      webEndpoint: row.webEndpoint ?? undefined,
      ensip25Status: row.ensip25Status as Ensip25Status,
    };
    // Re-stamped with the *stored* read time, not now. A snapshot reconstituted
    // with a fresh timestamp is a cache wearing a live value's clothes, and the
    // interface has no way left to tell the difference.
    return snapshot(fields, row.fetchedAt.toISOString());
  }

  async putGraphSnapshot(value: GraphSnapshot): Promise<GraphSnapshot> {
    const row = {
      agentId: value.agentId,
      fetchedAt: new Date(value.fetchedAt),
      chainId: value.chainId,
      graphAgentKey: value.graphAgentKey,
      subgraphId: value.subgraphId,
      registrationFile: value.registrationFile ?? null,
      feedbackCount: value.feedbackCount ?? null,
      // Null rather than 0 when the dimension is unavailable. A zero here would
      // be invented reputation, written to disk rather than merely rendered.
      validationCount: value.validationCount ?? null,
    };

    await this.db
      .insert(graphSnapshots)
      .values(row)
      .onConflictDoUpdate({ target: graphSnapshots.agentId, set: row });

    return value;
  }

  async getGraphSnapshot(agentId: string): Promise<GraphSnapshot | undefined> {
    const [row] = await this.db
      .select()
      .from(graphSnapshots)
      .where(eq(graphSnapshots.agentId, agentId));
    if (!row) return undefined;

    const fields: GraphFields = {
      agentId: row.agentId,
      chainId: row.chainId as ChainId,
      graphAgentKey: row.graphAgentKey,
      subgraphId: row.subgraphId,
      registrationFile: row.registrationFile,
      feedbackCount: row.feedbackCount ?? undefined,
      validationCount: row.validationCount ?? undefined,
    };
    return snapshot(fields, row.fetchedAt.toISOString());
  }

  //////////////////////////////////////////////////////////////////////////
  // Financial authority — references only
  //////////////////////////////////////////////////////////////////////////

  async putFinancialAuthority(
    ref: FinancialAuthorityRef,
  ): Promise<FinancialAuthorityRef> {
    const row = {
      agentId: ref.agentId,
      privyWalletId: ref.privyWalletId,
      walletAddress: ref.walletAddress,
      policyId: ref.policyId ?? null,
      policyLabel: ref.policyLabel ?? null,
    };

    await this.db
      .insert(financialAuthority)
      .values(row)
      .onConflictDoUpdate({ target: financialAuthority.agentId, set: row });

    return ref;
  }

  async getFinancialAuthority(
    agentId: string,
  ): Promise<FinancialAuthorityRef | undefined> {
    const [row] = await this.db
      .select()
      .from(financialAuthority)
      .where(eq(financialAuthority.agentId, agentId));
    if (!row) return undefined;

    return {
      agentId: row.agentId,
      privyWalletId: row.privyWalletId,
      walletAddress: row.walletAddress as Address,
      policyId: row.policyId ?? undefined,
      policyLabel: row.policyLabel ?? undefined,
    };
  }

  //////////////////////////////////////////////////////////////////////////
  // Activity
  //////////////////////////////////////////////////////////////////////////

  /**
   * Append one event.
   *
   * Two guards run before the insert. `assertEvidence` enforces the spec's
   * "evidence matches the source" for callers holding data the type system
   * never saw — a provider response is `unknown` however carefully the code
   * around it is typed — and {@link assertNoSecrets} refuses metadata that
   * looks like key material.
   */
  async recordEvent(event: NewActivityEvent): Promise<ActivityEvent> {
    assertEvidence(event.source, event.evidence);
    if (event.metadata) assertNoSecrets(event.metadata);

    const [row] = await this.db
      .insert(activityEvents)
      .values({
        id: event.id ?? randomUUID(),
        agentId: event.agentId ?? null,
        organizationId: event.organizationId,
        source: event.source,
        type: event.type,
        status: event.status,
        occurredAt: new Date(event.occurredAt),
        actor: event.actor ?? null,
        txHash: event.txHash ?? null,
        externalId: event.externalId ?? null,
        summary: event.summary,
        evidence: event.evidence,
        metadata: event.metadata ?? null,
      })
      .returning();

    return toActivityEvent(row!);
  }

  /**
   * Resolve a pending event in place.
   *
   * The spec requires an update rather than a second row: a timeline showing
   * "payment pending" above "payment executed" is a timeline claiming two
   * things happened. Returns undefined for an unknown id, so a caller resolving
   * something it never recorded finds out rather than silently no-opping.
   */
  async resolveEvent(
    id: string,
    patch: {
      status: ActivityStatus;
      summary?: string;
      txHash?: Hex;
      externalId?: string;
      evidence?: ActivityEvidence;
      metadata?: Record<string, unknown>;
    },
  ): Promise<ActivityEvent | undefined> {
    if (patch.metadata) assertNoSecrets(patch.metadata);

    const [row] = await this.db
      .update(activityEvents)
      .set({
        status: patch.status,
        ...(patch.summary !== undefined && { summary: patch.summary }),
        ...(patch.txHash !== undefined && { txHash: patch.txHash }),
        ...(patch.externalId !== undefined && { externalId: patch.externalId }),
        ...(patch.evidence !== undefined && { evidence: patch.evidence }),
        ...(patch.metadata !== undefined && { metadata: patch.metadata }),
      })
      .where(eq(activityEvents.id, id))
      .returning();

    return row ? toActivityEvent(row) : undefined;
  }

  /**
   * The activity timeline, newest first.
   *
   * Denied and failed events are returned like any other, deliberately: a
   * denial is evidence that the control plane worked, and a timeline that
   * quietly drops them is a timeline that only ever shows success.
   */
  async listActivity(filter: ActivityFilter = {}): Promise<ActivityEvent[]> {
    const clauses: SQL[] = [];
    if (filter.organizationId) {
      clauses.push(eq(activityEvents.organizationId, filter.organizationId));
    }
    if (filter.agentId) clauses.push(eq(activityEvents.agentId, filter.agentId));
    if (filter.source) clauses.push(eq(activityEvents.source, filter.source));
    if (filter.type) clauses.push(eq(activityEvents.type, filter.type));
    if (filter.status) clauses.push(eq(activityEvents.status, filter.status));

    const rows = await this.db
      .select()
      .from(activityEvents)
      .where(clauses.length ? and(...clauses) : undefined)
      // `id` breaks ties, so a page boundary cannot drop or repeat an event
      // that shares a timestamp with its neighbour.
      .orderBy(desc(activityEvents.occurredAt), activityEvents.id)
      .limit(Math.min(filter.limit ?? 100, 500));

    return rows.map(toActivityEvent);
  }

  ////////////////////////////////////////////////////////////////////////////
  // Site traffic
  ////////////////////////////////////////////////////////////////////////////

  /**
   * Record one page view and return the totals including it.
   *
   * Returning the stats from the same call is deliberate: the caller is a
   * browser that just arrived, and a separate read would either race its own
   * write or need a second round trip to show a number that is already known.
   */
  async recordPageView(view: {
    visitorId: string;
    path: string;
    isBot: boolean;
  }): Promise<PageViewStats> {
    await this.db.insert(pageViews).values({
      id: randomUUID(),
      visitorId: view.visitorId,
      path: view.path,
      isBot: view.isBot,
    });

    return this.pageViewStats();
  }

  async pageViewStats(): Promise<PageViewStats> {
    // One pass. Two queries would let the bot count and the view count come
    // from different instants, which is visible as a total that does not add
    // up on a busy page.
    const [row] = await this.db
      .select({
        views: sql<string>`count(*) filter (where ${pageViews.isBot} = false)`,
        visitors: sql<string>`count(distinct ${pageViews.visitorId}) filter (where ${pageViews.isBot} = false)`,
        botViews: sql<string>`count(*) filter (where ${pageViews.isBot} = true)`,
        since: sql<Date | null>`min(${pageViews.createdAt})`,
      })
      .from(pageViews);

    return {
      views: Number(row?.views ?? 0),
      visitors: Number(row?.visitors ?? 0),
      botViews: Number(row?.botViews ?? 0),
      since: row?.since ? new Date(row.since).toISOString() : null,
    };
  }
}

//////////////////////////////////////////////////////////////////////////////
// Guards
//////////////////////////////////////////////////////////////////////////////

const SECRET_KEY_PATTERN =
  /(private[_-]?key|secret|mnemonic|seed[_-]?phrase|authorization[_-]?key|signing[_-]?key|app[_-]?secret|api[_-]?key|bearer|password|credential)/i;

/**
 * Refuse metadata that carries key material.
 *
 * `metadata` is the one untyped column in the store, which makes it the one
 * place a provider secret could arrive by accident — a handler recording a
 * failed request by attaching the request it sent. Recursive, because the shape
 * that does that is nested.
 *
 * The check reads key names and deliberately not value shapes. A secp256k1
 * private key is 32 bytes of hex and so is a transaction hash, a namehash, a
 * block hash, and an EAC resource — every one of which is evidence this store
 * exists to record. No test separates them, so a value-shaped heuristic would
 * reject the store's most common legitimate content while a key pasted under an
 * innocent name would still pass. The name is the only honest signal here; the
 * typed entity fields are what make a credential unspellable everywhere else.
 */
export function assertNoSecrets(value: unknown, path: string[] = []): void {
  if (value === null || typeof value !== "object") return;

  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoSecrets(entry, [...path, String(index)]),
    );
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      throw new Error(
        `Refusing to persist a secret-shaped key at metadata.${[...path, key].join(".")}. ` +
          "The store holds provider identifiers and addresses, never credentials.",
      );
    }
    assertNoSecrets(entry, [...path, key]);
  }
}

//////////////////////////////////////////////////////////////////////////////
// Row mapping
//////////////////////////////////////////////////////////////////////////////

type OrganizationRow = typeof organizations.$inferSelect;
type AgentRow = typeof agents.$inferSelect;
type ProvisioningRow = typeof agentProvisioning.$inferSelect;
type ActivityEventRow = typeof activityEvents.$inferSelect;

/** What a `select().from(agents).leftJoin(agentProvisioning)` row looks like. */
interface JoinedAgentRow {
  agents: AgentRow;
  agent_provisioning: ProvisioningRow | null;
}

function toOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id,
    displayName: row.displayName,
    parentEnsName: row.parentEnsName,
    chainId: row.chainId as ChainId,
    createdAt: row.createdAt.toISOString(),
  };
}

function toAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    organizationId: row.organizationId,
    slug: row.slug,
    ensName: row.ensName,
    controllerAddress: row.controllerAddress as Address,
    erc8004AgentId: row.erc8004AgentId ?? undefined,
    erc8004Registry: (row.erc8004Registry as Address | null) ?? undefined,
    privyWalletId: row.privyWalletId ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toProvisioning(row: ProvisioningRow | null): ProvisioningStatus {
  return {
    ens: (row?.ens ?? INITIAL_PROVISIONING.ens) as ProvisioningStatus["ens"],
    erc8004: (row?.erc8004 ??
      INITIAL_PROVISIONING.erc8004) as ProvisioningStatus["erc8004"],
    ensip25: (row?.ensip25 ??
      INITIAL_PROVISIONING.ensip25) as ProvisioningStatus["ensip25"],
    graph: (row?.graph ??
      INITIAL_PROVISIONING.graph) as ProvisioningStatus["graph"],
    financial: (row?.financial ??
      INITIAL_PROVISIONING.financial) as ProvisioningStatus["financial"],
  };
}

function toAgentWithProvisioning(row: JoinedAgentRow): AgentWithProvisioning {
  return {
    ...toAgent(row.agents),
    provisioning: toProvisioning(row.agent_provisioning),
  };
}

function toActivityEvent(row: ActivityEventRow): ActivityEvent {
  return {
    id: row.id,
    agentId: row.agentId ?? undefined,
    organizationId: row.organizationId,
    source: row.source as ActivitySource,
    type: row.type as ActivityType,
    status: row.status as ActivityStatus,
    occurredAt: row.occurredAt.toISOString(),
    actor: (row.actor as Address | null) ?? undefined,
    txHash: (row.txHash as Hex | null) ?? undefined,
    externalId: row.externalId ?? undefined,
    summary: row.summary,
    evidence: row.evidence,
    metadata: row.metadata ?? undefined,
  };
}
