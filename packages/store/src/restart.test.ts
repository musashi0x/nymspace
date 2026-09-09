import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  Store,
  closeDatabase,
  database,
  migrate,
  type Database,
} from "./index";

/**
 * Task 2.6 — write an agent and an event, restart the process, read both back.
 *
 * The restart is real: a separate `tsx` process writes and exits, and this
 * process reads what survived it. Writing and reading through one connection
 * would prove the query works and nothing about durability, and the failure
 * being guarded against — `docs/17` Risk 9 — is in-memory state that looks
 * exactly like a working system until the moment the process ends.
 *
 * The second assertion is the one the capability spec actually asks for, and it
 * is stronger than "the rows are still there": the surviving identifiers must
 * be *sufficient to reload every external state the console displays*. So the
 * test checks that the ENS name, the ERC 8004 agent id and registry, and the
 * Privy wallet id all came back — those four are what every later read is keyed
 * on, and a store that lost any one of them would leave an agent visible and
 * unusable.
 *
 * Requires `docker compose up -d`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const WRITER = resolve(HERE, "..", "scripts", "restart-writer.ts");

const organizationId = `org-restart-${randomUUID()}`;
const agentId = `agent-restart-${randomUUID()}`;
const eventId = randomUUID();

let db: Database;
let store: Store;

beforeAll(async () => {
  db = database();
  await migrate(db);
  store = new Store(db);
});

afterAll(async () => {
  await db.execute(sql`delete from organizations where id = ${organizationId}`);
  await closeDatabase();
});

describe("the store survives a restart", () => {
  it("reads back an agent and an event written by a process that has exited", () => {
    const output = execFileSync(
      "node",
      [
        "--import",
        "tsx",
        "--conditions=react-server",
        WRITER,
        organizationId,
        agentId,
        eventId,
      ],
      {
        encoding: "utf8",
        env: process.env,
        cwd: resolve(HERE, ".."),
      },
    );

    // The writer process is gone by the time this returns; everything asserted
    // below came off disk rather than out of a shared heap.
    expect(output).toContain("written");
  });

  it("keeps every identifier the console needs to reload external state", async () => {
    const agent = await store.getAgent(agentId);

    expect(agent).toBeDefined();
    expect(agent?.ensName).toBe("research.nymspace.eth");
    expect(agent?.erc8004AgentId).toBe("1");
    expect(agent?.erc8004Registry).toBe(
      "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    );
    expect(agent?.privyWalletId).toBe("wallet-restart");
  });

  it("keeps the five provisioning tracks it was left in", async () => {
    const agent = await store.getAgent(agentId);

    expect(agent?.provisioning).toEqual({
      ens: "active",
      erc8004: "registered",
      ensip25: "verified",
      graph: "not_indexed",
      financial: "no_wallet",
    });
  });

  it("keeps the activity event and its evidence", async () => {
    const events = await store.listActivity({ agentId });

    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe(eventId);
    expect(events[0]?.evidence).toMatchObject({
      source: "ens",
      contractAddress: "0x45DaD53A7ad21fd62709DFa46e65C7501ed7C6eC",
    });
  });
});
