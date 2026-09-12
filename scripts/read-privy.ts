/**
 * What Privy actually holds, and whether the store agrees.
 *
 * The financial counterpart to `pnpm --filter @nymspace/ens read:fleet`: reads
 * only, writes nothing, spends nothing, and answers the one question the
 * console cannot.
 *
 * ## The failure it exists to name
 *
 * `GET /v1/treasury` reports `no_wallet` for an agent when the coordination
 * store has no `financial_authority` row. That is the correct reading of the
 * store — and it is not the same claim as "this deployment has no wallet".
 * Privy is the authority on what wallets exist; the store only records which
 * agent a wallet was bound to.
 *
 * So a wallet created by an earlier `pnpm provision:wallet` against a database
 * that was later recreated is invisible from every screen, while still existing
 * and still being billable. Worse, `provision:wallet` keys its reuse check off
 * `store.getFinancialAuthority`, so running it in that state does not reuse the
 * orphan — it creates a second wallet and a second policy beside it, and
 * `PRIVY_POLICY_ID` in the environment then names neither.
 *
 * Run this before provisioning. If it reports a wallet Privy has and the store
 * does not, the remedy is to bind the existing one rather than mint another.
 */

import { PrivyClient, agentSignerKey } from "@nymspace/privy";
import { Store, closeDatabase, database } from "@nymspace/store";

// Must match `apps/api/src/deps.ts` and the provisioning scripts. See the
// runbook's note on why a different value here fails silently.
const ORGANIZATION_ID = "nymspace";

async function main() {
  const privy = new PrivyClient({ authorizationKey: agentSignerKey() });

  const wallets = await privy.listWallets();
  console.log(`privy — ${wallets.length} wallet(s) on this app\n`);
  for (const w of wallets) {
    console.log(`  ${w.id}`);
    console.log(`    address  ${w.address}`);
  }

  const configuredPolicy = process.env["PRIVY_POLICY_ID"];
  if (configuredPolicy) {
    try {
      const limit = await privy.getPolicyLimit(configuredPolicy);
      console.log(
        `\n  PRIVY_POLICY_ID ${configuredPolicy}\n` +
          `    name   ${limit.name}\n` +
          `    rule   ${limit.ruleName}\n` +
          `    max    ${limit.maxAmount} (base units of ${limit.token?.symbol ?? "native ETH"})`,
      );
    } catch (error) {
      /*
        Unreadable is its own answer, never folded into absent. A policy id that
        names nothing and a policy that could not be fetched have opposite
        remedies, and `routes/treasury.ts` keeps the same two states apart for
        the same reason.
      */
      const message = error instanceof Error ? error.message : String(error);
      console.log(
        `\n  PRIVY_POLICY_ID ${configuredPolicy}\n    UNREADABLE — ${message.split("\n")[0]}`,
      );
    }
  } else {
    console.log("\n  PRIVY_POLICY_ID is not set");
  }

  const db = database();
  const store = new Store(db);
  const agents = await store.listAgents(ORGANIZATION_ID);

  console.log(`\nstore — ${agents.length} agent(s) under "${ORGANIZATION_ID}"\n`);
  const bound = new Set<string>();
  for (const agent of agents) {
    const ref = await store.getFinancialAuthority(agent.id);
    if (ref?.privyWalletId) bound.add(ref.privyWalletId);
    console.log(
      `  ${agent.ensName.padEnd(24)} ${
        ref?.walletAddress
          ? `${ref.walletAddress}  policy ${ref.policyId ?? "(none)"}`
          : "no financial authority row"
      }`,
    );
  }

  const orphans = wallets.filter((w) => !bound.has(w.id));
  console.log();
  if (wallets.length === 0) {
    console.log("Nothing provisioned. `pnpm provision:wallet` creates the first wallet.");
  } else if (orphans.length === 0) {
    console.log("Every Privy wallet is bound to an agent. The console's reading is the whole truth.");
  } else {
    console.log(
      `${orphans.length} Privy wallet(s) no agent points at:\n` +
        orphans.map((w) => `  ${w.id}  ${w.address}`).join("\n") +
        "\n\nThe store is behind Privy, not the other way round. Binding the\n" +
        "existing wallet is cheaper and more honest than provisioning a second\n" +
        "one beside it — `provision:wallet` will do the latter, because its\n" +
        "reuse check reads the store rather than Privy.",
    );
  }

  await closeDatabase();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
