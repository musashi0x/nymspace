/**
 * Bind a Privy wallet that already exists to an agent, and give it a real limit.
 *
 * `pnpm provision:wallet` is the path for a deployment with nothing yet. This
 * is the path for the state `pnpm read:privy` reports: a wallet Privy holds and
 * no agent points at, because the coordination store was recreated after it was
 * made. Provisioning again in that state does not adopt the orphan — its reuse
 * check reads `store.getFinancialAuthority` — so it mints a second wallet and a
 * second policy beside a funded one, and `PRIVY_POLICY_ID` then names neither.
 *
 * ## The limit, and why the seed constant could not supply it
 *
 * `provision-wallet.ts` seeds `SEED_LIMIT_UNITS = "10"`, which `toBaseUnits`
 * turns into 10 USDC against a token and **10 ETH** against native — and its
 * own guard then refuses to run, because the demo amounts must bracket the
 * limit as `allowed <= limit < denied` and 10 ETH is not below a denied amount
 * of 0.01. The constant is right for the token arrangement `.env.example`
 * documents and wrong for the native-ETH one this deployment is configured for.
 *
 * So the limit is derived from the two demo amounts rather than from a
 * constant: the geometric midpoint, which brackets by construction for any pair
 * an operator sets. A policy that does not sit between them proves nothing —
 * it either allows both amounts or denies both, and Gate C's whole argument is
 * that the *same* request changes outcome when only the limit moves.
 */

import { PrivyClient, agentSignerKey } from "@nymspace/privy";
import { Store, closeDatabase, database } from "@nymspace/store";
import { requireServerEnv } from "@nymspace/core/env";
import type { Address } from "@nymspace/core";

const ORGANIZATION_ID = "nymspace";

/** The agent that gets the wallet. Overridable, because which one is a choice. */
const AGENT_DB_ID = process.env["BIND_AGENT_ID"] ?? "agent-research";

function integerSqrt(value: bigint): bigint {
  if (value < 2n) return value;
  let x = value;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + value / x) / 2n;
  }
  return x;
}

async function main() {
  const keys = requireServerEnv([
    "DEMO_ALLOWED_PAYMENT_AMOUNT",
    "DEMO_DENIED_PAYMENT_AMOUNT",
  ] as const);

  const allowed = BigInt(keys.DEMO_ALLOWED_PAYMENT_AMOUNT);
  const denied = BigInt(keys.DEMO_DENIED_PAYMENT_AMOUNT);

  if (allowed >= denied) {
    throw new Error(
      `DEMO_ALLOWED_PAYMENT_AMOUNT (${allowed}) must be below ` +
        `DEMO_DENIED_PAYMENT_AMOUNT (${denied}). With them the other way round ` +
        "no limit can sit between them, and the gate proves nothing.",
    );
  }

  /*
    Geometric, not arithmetic. These amounts are usually orders of magnitude
    apart — 0.0001 and 0.01 ETH here — and the arithmetic mean of that pair sits
    within a rounding error of the larger one, so a denied amount only slightly
    over the limit would be indistinguishable from noise. The geometric midpoint
    is one order below each, which is the margin that makes the denial legible.
  */
  const limit = integerSqrt(allowed * denied);
  if (!(allowed <= limit && limit < denied)) {
    throw new Error(
      `Derived limit ${limit} does not bracket ${allowed} and ${denied}.`,
    );
  }

  const privy = new PrivyClient({ authorizationKey: agentSignerKey() });
  const db = database();
  const store = new Store(db);

  const agent = await store.getAgent(AGENT_DB_ID);
  if (!agent) {
    throw new Error(
      `${AGENT_DB_ID} is not in the store. Run \`pnpm sync:fleet\` first, or set BIND_AGENT_ID.`,
    );
  }

  const existing = await store.getFinancialAuthority(AGENT_DB_ID);
  if (existing?.policyId) {
    console.log(
      `${agent.ensName} already points at wallet ${existing.privyWalletId} ` +
        `under policy ${existing.policyId}. Nothing to bind.`,
    );
    await closeDatabase();
    return;
  }

  const wallets = await privy.listWallets();
  if (wallets.length === 0) {
    throw new Error(
      "Privy holds no wallets. This script adopts an existing one; " +
        "`pnpm provision:wallet` is what creates the first.",
    );
  }

  // Every agent already bound, so an unbound wallet is genuinely spare.
  const agents = await store.listAgents(ORGANIZATION_ID);
  const bound = new Set<string>();
  for (const each of agents) {
    const ref = await store.getFinancialAuthority(each.id);
    if (ref?.privyWalletId) bound.add(ref.privyWalletId);
  }

  const wallet = wallets.find((candidate) => !bound.has(candidate.id));
  if (!wallet) {
    throw new Error(
      "Every Privy wallet is already bound to an agent. Nothing to adopt.",
    );
  }

  console.log(`Adopting ${wallet.id} at ${wallet.address} for ${agent.ensName}`);
  console.log(
    `  allowed ${allowed} <= limit ${limit} < denied ${denied} (wei)\n`,
  );

  /*
    A new policy rather than `PRIVY_POLICY_ID`.

    That variable currently names a policy with no `lte` condition on an
    amount — `getPolicyLimit` refuses to render it, correctly, because a policy
    that constrains nothing must not be displayed as one that does. Attaching it
    would put a wallet on screen as governed while nothing caps it.
  */
  const created = await privy.createAmountPolicy({
    name: `nymspace ${agent.slug} max transfer`,
    maxValueWei: limit,
  });
  console.log(`  policy   ${created.policyId} — ${created.ruleName}`);

  await privy.setWalletPolicies(wallet.id, [created.policyId]);
  console.log(`  attached to ${wallet.id}`);

  await store.putFinancialAuthority({
    agentId: AGENT_DB_ID,
    privyWalletId: wallet.id,
    walletAddress: wallet.address as Address,
    policyId: created.policyId,
    policyLabel: created.name,
  });
  console.log(`  bound in the store\n`);

  // Read it back through the same call the console uses, so this prints what
  // the screen will print rather than what was just sent.
  const readBack = await privy.getPolicyLimit(created.policyId);
  console.log(
    `Treasury will now read: ${wallet.address} capped at ${readBack.maxAmount} ` +
      `(${readBack.token?.symbol ?? "native ETH"} base units)`,
  );
  console.log(`\nPut this in .env:\n  PRIVY_POLICY_ID=${created.policyId}`);

  await closeDatabase();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
