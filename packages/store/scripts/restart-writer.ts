/**
 * The writer half of the restart durability test (task 2.6).
 *
 * A separate process on purpose. A test that writes and reads through one
 * connection proves the query works and nothing about durability, and
 * in-memory state that survives within a process is exactly the failure
 * `docs/17` Risk 9 names — the one that looks like success right up until the
 * demo. So this process writes, exits, and the test process reads what is left.
 *
 * Invoked by `restart.test.ts`, not by hand. Takes the ids on argv so the test
 * controls them and can assert on the exact rows it asked for.
 */

import { Store, closeDatabase, database, migrate } from "../src/index";

const [organizationId, agentId, eventId] = process.argv.slice(2);

if (!organizationId || !agentId || !eventId) {
  console.error("usage: restart-writer.ts <organizationId> <agentId> <eventId>");
  process.exit(2);
}

async function main(): Promise<void> {
  const db = database();
  await migrate(db);
  const store = new Store(db);

  await store.upsertOrganization({
    id: organizationId!,
    displayName: "Nymspace",
    parentEnsName: "nymspace.eth",
    chainId: 11155111,
  });

  await store.upsertAgent({
    id: agentId!,
    organizationId: organizationId!,
    slug: "research",
    ensName: "research.nymspace.eth",
    controllerAddress: "0xDEA25D2537cE06cE1073dd9621C70056CBDC3aEB",
    erc8004AgentId: "1",
    erc8004Registry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    privyWalletId: "wallet-restart",
  });

  await store.setProvisioning(agentId!, {
    ens: "active",
    erc8004: "registered",
    ensip25: "verified",
  });

  await store.recordEvent({
    id: eventId!,
    organizationId: organizationId!,
    agentId: agentId!,
    source: "ens",
    type: "ens.record.updated",
    status: "success",
    occurredAt: new Date().toISOString(),
    summary: "agent-endpoint[mcp] written before the restart",
    evidence: {
      source: "ens",
      txHash: `0x${"d".repeat(64)}`,
      contractAddress: "0x45DaD53A7ad21fd62709DFa46e65C7501ed7C6eC",
    },
  });

  await closeDatabase();
  console.log("written");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
