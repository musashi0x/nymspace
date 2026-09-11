import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  Store,
  closeDatabase,
  database,
  migrate,
  snapshot,
  isStale,
  assertEvidence,
  type Database,
} from "./index";

/**
 * The store's behaviour, against a real Postgres.
 *
 * Deliberately not a fake. Task 2.6 asserts durability across a process
 * boundary and the capability spec's whole point is that in-memory state is the
 * failure that looks like success — a double that lives in the test process
 * cannot fail either of those ways, so it would be testing the wrong object.
 *
 * Requires `docker compose up -d`.
 */

let db: Database;
let store: Store;

const ORG_ID = "org-test";

beforeAll(async () => {
  db = database();
  await migrate(db);
  store = new Store(db);
});

afterAll(async () => {
  await closeDatabase();
});

beforeEach(async () => {
  // Cascades to agents, provisioning, snapshots, and events.
  await db.execute(sql`delete from organizations where id = ${ORG_ID}`);
  await store.upsertOrganization({
    id: ORG_ID,
    displayName: "Nymspace",
    parentEnsName: "nymspace.eth",
    chainId: 11155111,
  });
});

/**
 * Fixture ids are namespaced under the test organization.
 *
 * They were plain `agent-<slug>` once, which collided with the ids the real
 * provisioning script writes — same database, same primary key, different
 * organization. The upsert then kept the first organization, the provisioning
 * run reported success, and the agent disappeared from its own fleet listing.
 * The collision is fixed here and the silent overwrite is fixed in `store.ts`.
 */
function agentFixture(slug: string) {
  return {
    id: `${ORG_ID}-${slug}`,
    organizationId: ORG_ID,
    slug,
    ensName: `${slug}.nymspace.eth`,
    controllerAddress: "0xDEA25D2537cE06cE1073dd9621C70056CBDC3aEB" as const,
  };
}

describe("agents and provisioning", () => {
  it("gives a new agent five independent tracks, none of them a global flag", async () => {
    await store.upsertAgent(agentFixture("research"));
    const agent = await store.getAgent(`${ORG_ID}-research`);

    expect(agent?.provisioning).toEqual({
      ens: "draft",
      erc8004: "unregistered",
      ensip25: "unchecked",
      graph: "not_indexed",
      financial: "no_wallet",
    });
    // The requirement is the absence: there is no single readiness value that
    // could hide which of the five is incomplete.
    expect(agent).not.toHaveProperty("active");
    expect(agent).not.toHaveProperty("status");
  });

  it("advances one track without disturbing the others", async () => {
    await store.upsertAgent(agentFixture("research"));
    await store.setProvisioning(`${ORG_ID}-research`, { ens: "active" });
    const after = await store.setProvisioning(`${ORG_ID}-research`, {
      ensip25: "verified",
    });

    expect(after.ens).toBe("active");
    expect(after.ensip25).toBe("verified");
    expect(after.financial).toBe("no_wallet");
  });

  /**
   * Provisioning arrives in stages across three integrations. An ENS update
   * that carries no wallet id must not erase the wallet id the Privy step
   * recorded — the bug that would make an agent lose its wallet halfway through
   * the demo and read as never having had one.
   */
  it("does not erase identifiers written by another integration", async () => {
    await store.upsertAgent(agentFixture("research"));
    await store.upsertAgent({
      ...agentFixture("research"),
      privyWalletId: "wallet-1",
    });
    await store.upsertAgent({
      ...agentFixture("research"),
      erc8004AgentId: "42",
    });

    const agent = await store.getAgent(`${ORG_ID}-research`);
    expect(agent?.privyWalletId).toBe("wallet-1");
    expect(agent?.erc8004AgentId).toBe("42");
  });

  it("lists an organization's agents in a stable order", async () => {
    await store.upsertAgent(agentFixture("trader"));
    await store.upsertAgent(agentFixture("research"));
    await store.upsertAgent(agentFixture("deploy"));

    const slugs = (await store.listAgents(ORG_ID)).map((a) => a.slug);
    expect(slugs).toEqual(["deploy", "research", "trader"]);
  });
});

describe("snapshots are caches that know when they were true", () => {
  beforeEach(async () => {
    await store.upsertAgent(agentFixture("research"));
  });

  it("round-trips the read time rather than restamping it", async () => {
    const fetchedAt = "2026-09-01T10:00:00.000Z";
    await store.putIdentitySnapshot(
      snapshot(
        {
          agentId: `${ORG_ID}-research`,
          owner: "0xB5e8e4b8543f2B1093bDCA55A3F7Fd16f56F55C9" as const,
          resolver: "0x45DaD53A7ad21fd62709DFa46e65C7501ed7C6eC" as const,
          ensip25Status: "verified" as const,
        },
        fetchedAt,
      ),
    );

    const read = await store.getIdentitySnapshot(`${ORG_ID}-research`);
    expect(read?.fetchedAt).toBe(fetchedAt);
    // The assertion that matters: a value stored eight days ago must still say
    // so, or the interface has nothing left to label it with.
    expect(isStale(read!, 60_000, Date.parse("2026-09-09T10:00:00.000Z"))).toBe(
      true,
    );
  });

  /**
   * No ValidationRegistry is deployed on either Sepolia network. An absent
   * dimension must survive the round trip as absent — if it comes back as 0,
   * the trust panel renders "Validation 0" and the product has invented a
   * reputation for an agent that was never validated either way.
   */
  it("keeps an absent validation count absent rather than zero", async () => {
    await store.putGraphSnapshot(
      snapshot({
        agentId: `${ORG_ID}-research`,
        chainId: 11155111,
        graphAgentKey: "11155111:1",
        subgraphId: "6wQRC7geo9XYAhckfmfo8kbMRLeWU8KQd3XsJqFKmZLT",
        registrationFile: { name: "research" },
        feedbackCount: 0,
      }),
    );

    const read = await store.getGraphSnapshot(`${ORG_ID}-research`);
    expect(read?.validationCount).toBeUndefined();
    // Contrast: a feedback count of zero is a real measurement and stays zero.
    expect(read?.feedbackCount).toBe(0);
  });
});

describe("financial authority holds references and no credentials", () => {
  beforeEach(async () => {
    await store.upsertAgent(agentFixture("research"));
  });

  it("round-trips the wallet reference", async () => {
    await store.putFinancialAuthority({
      agentId: `${ORG_ID}-research`,
      privyWalletId: "wallet-1",
      walletAddress: "0x1111111111111111111111111111111111111111",
      policyId: "policy-1",
      policyLabel: "Max 10 USDC per payment",
    });

    const ref = await store.getFinancialAuthority(`${ORG_ID}-research`);
    expect(ref?.privyWalletId).toBe("wallet-1");
    expect(ref?.policyId).toBe("policy-1");
  });
});

describe("activity is one log with per-source provenance", () => {
  beforeEach(async () => {
    await store.upsertAgent(agentFixture("research"));
  });

  const base = {
    organizationId: ORG_ID,
    agentId: `${ORG_ID}-research`,
    occurredAt: new Date().toISOString(),
  };

  it("records an ENS event with its transaction hash", async () => {
    const event = await store.recordEvent({
      ...base,
      source: "ens",
      type: "ens.record.updated",
      status: "success",
      summary: "agent-endpoint[mcp] written",
      evidence: {
        source: "ens",
        txHash: `0x${"a".repeat(64)}`,
        contractAddress: "0x45DaD53A7ad21fd62709DFa46e65C7501ed7C6eC",
      },
    });

    expect(event.id).toBeTruthy();
    expect(event.evidence).toMatchObject({ source: "ens" });
  });

  it("refuses an ENS event with no transaction hash", () => {
    expect(() =>
      assertEvidence("ens", {
        source: "ens",
        txHash: "" as `0x${string}`,
        contractAddress: "0x45DaD53A7ad21fd62709DFa46e65C7501ed7C6eC",
      }),
    ).toThrow(/must carry a transaction hash/);
  });

  it("refuses a graph event with no subgraph id or query time", () => {
    expect(() =>
      assertEvidence("graph", {
        source: "graph",
        chainId: 11155111,
        subgraphId: "",
        queriedAt: "",
      }),
    ).toThrow(/subgraph id/);
  });

  /**
   * A denied payment never reaches a chain, so it has no transaction hash. If
   * the evidence check demanded one, the store could not record the denial at
   * all — and the denial is the deliverable.
   */
  it("accepts a privy denial carrying only a request id", () => {
    expect(() =>
      assertEvidence("privy", {
        source: "privy",
        requestId: "req-1",
        policyDecision: "over_limit",
      }),
    ).not.toThrow();

    expect(() => assertEvidence("privy", { source: "privy" })).toThrow(
      /request identifier or a transaction hash/,
    );
  });

  it("rejects evidence that belongs to a different source", () => {
    expect(() =>
      assertEvidence("ens", {
        source: "graph",
        chainId: 11155111,
        subgraphId: "x",
        queriedAt: new Date().toISOString(),
      }),
    ).toThrow(/evidence is for graph/);
  });

  it("retains denied and failed events", async () => {
    await store.recordEvent({
      ...base,
      source: "ens",
      type: "ens.action.denied",
      status: "denied",
      summary: "controller setText on the ENSIP 25 key reverted",
      evidence: {
        source: "ens",
        txHash: `0x${"b".repeat(64)}`,
        contractAddress: "0x45DaD53A7ad21fd62709DFa46e65C7501ed7C6eC",
      },
    });

    const denied = await store.listActivity({ organizationId: ORG_ID, status: "denied" });
    expect(denied).toHaveLength(1);
    expect(denied[0]?.type).toBe("ens.action.denied");
  });

  /**
   * The spec requires a pending event to resolve in place. Two rows would be a
   * timeline claiming two things happened, which is what an operator watching a
   * payment would read it as.
   */
  it("resolves a pending event in place rather than appending a second one", async () => {
    const id = randomUUID();
    await store.recordEvent({
      id,
      ...base,
      source: "privy",
      type: "privy.payment.executed",
      status: "pending",
      summary: "payment submitted",
      evidence: { source: "privy", requestId: "req-1" },
    });

    const resolved = await store.resolveEvent(id, {
      status: "success",
      summary: "payment executed",
      txHash: `0x${"c".repeat(64)}`,
    });

    expect(resolved?.status).toBe("success");
    const all = await store.listActivity({ agentId: `${ORG_ID}-research` });
    expect(all).toHaveLength(1);
    expect(all[0]?.summary).toBe("payment executed");
  });

  it("reports an unknown id rather than silently no-opping", async () => {
    expect(await store.resolveEvent(randomUUID(), { status: "success" })).toBeUndefined();
  });

  /**
   * Reading one event back by id is what makes an approval an approval of the
   * request that was denied: the amount comes from the row, never from the
   * client that is asking for it to be approved.
   */
  it("reads a single event back by id, with its recorded request", async () => {
    const id = randomUUID();
    await store.recordEvent({
      id,
      ...base,
      source: "privy",
      type: "privy.payment.denied",
      status: "denied",
      summary: "over-limit payment denied",
      evidence: { source: "privy", requestId: "req-2", policyDecision: "denied" },
      metadata: { amount: "100000000", recipient: `0x${"b".repeat(40)}` },
    });

    const event = await store.getEvent(id);
    expect(event?.status).toBe("denied");
    expect(event?.metadata).toMatchObject({ amount: "100000000" });
    expect(await store.getEvent(randomUUID())).toBeUndefined();
  });

  it("filters by agent, source, type, and status independently", async () => {
    await store.upsertAgent(agentFixture("trader"));
    const at = (minutes: number) =>
      new Date(Date.parse("2026-09-09T00:00:00.000Z") + minutes * 60_000).toISOString();

    await store.recordEvent({
      ...base,
      occurredAt: at(1),
      source: "ens",
      type: "ens.record.updated",
      status: "success",
      summary: "a",
      evidence: {
        source: "ens",
        txHash: `0x${"1".repeat(64)}`,
        contractAddress: "0x45DaD53A7ad21fd62709DFa46e65C7501ed7C6eC",
      },
    });
    await store.recordEvent({
      ...base,
      agentId: `${ORG_ID}-trader`,
      occurredAt: at(2),
      source: "graph",
      type: "graph.discovery.executed",
      status: "success",
      summary: "b",
      evidence: {
        source: "graph",
        chainId: 11155111,
        subgraphId: "sub-1",
        queriedAt: at(2),
      },
    });

    expect(await store.listActivity({ organizationId: ORG_ID, agentId: `${ORG_ID}-research` })).toHaveLength(1);
    expect(await store.listActivity({ organizationId: ORG_ID, source: "graph" })).toHaveLength(1);
    expect(await store.listActivity({ organizationId: ORG_ID, type: "ens.record.updated" })).toHaveLength(1);
    expect(await store.listActivity({ organizationId: ORG_ID, status: "success" })).toHaveLength(2);

    // Newest first, by occurrence rather than by insertion.
    const ordered = await store.listActivity({ organizationId: ORG_ID });
    expect(ordered.map((e) => e.summary)).toEqual(["b", "a"]);
  });

  it("refuses to persist metadata carrying a credential", async () => {
    await expect(
      store.recordEvent({
        ...base,
        source: "privy",
        type: "privy.payment.denied",
        status: "denied",
        summary: "over limit",
        evidence: { source: "privy", requestId: "req-2" },
        metadata: { request: { appSecret: "leaked" } },
      }),
    ).rejects.toThrow(/secret-shaped key/);
  });
});

describe("page views", () => {
  /**
   * Asserted as deltas, not absolutes.
   *
   * `pageViewStats` aggregates the whole table and `page_views` hangs off no
   * organization, so the `beforeEach` cascade does not reach it. The obvious
   * fix — truncate in setup — would delete real traffic from whatever database
   * the suite is pointed at, which on this project is the same one the demo
   * uses. Measuring the change instead is both safe and a stronger assertion:
   * it holds on an empty table and on a busy one.
   */
  const marker = () => `test-${randomUUID()}`;

  it("counts a repeat visitor once and their views twice", async () => {
    const before = await store.pageViewStats();
    const visitorId = marker();

    await store.recordPageView({ visitorId, path: "/", isBot: false });
    const after = await store.recordPageView({
      visitorId,
      path: "/console",
      isBot: false,
    });

    expect(after.views - before.views).toBe(2);
    expect(after.visitors - before.visitors).toBe(1);

    await db.execute(sql`delete from page_views where visitor_id = ${visitorId}`);
  });

  it("keeps bots out of views and visitors, and counts them separately", async () => {
    const before = await store.pageViewStats();
    const human = marker();
    const bot = marker();

    await store.recordPageView({ visitorId: human, path: "/", isBot: false });
    const after = await store.recordPageView({
      visitorId: bot,
      path: "/",
      isBot: true,
    });

    // The claim the landing page makes: a bot moves the excluded count and
    // nothing else. If it ever leaked into `views`, the page would be
    // overstating readership while displaying a filter that says it does not.
    expect(after.views - before.views).toBe(1);
    expect(after.visitors - before.visitors).toBe(1);
    expect(after.botViews - before.botViews).toBe(1);

    await db.execute(
      sql`delete from page_views where visitor_id in (${human}, ${bot})`,
    );
  });

  it("reports when counting started", async () => {
    const visitorId = marker();
    const stats = await store.recordPageView({
      visitorId,
      path: "/",
      isBot: false,
    });

    // Never null once a row exists — a total with no start date reads as
    // all-time and is not.
    expect(stats.since).not.toBeNull();
    expect(new Date(stats.since!).getTime()).toBeLessThanOrEqual(Date.now());

    await db.execute(sql`delete from page_views where visitor_id = ${visitorId}`);
  });
});
