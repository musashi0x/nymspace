/**
 * Give the research agent a wallet under one enforceable policy — tasks 5.2
 * through 5.5.
 *
 * Run: pnpm provision:wallet
 *
 * Four steps, and the order is the point. The policy is created before the
 * wallet so the wallet is governed from its first block rather than from
 * whenever an attach call happened to land; the wallet is funded last, above
 * the denied amount, so that Gate C's denial cannot be explained by an empty
 * balance.
 *
 * Base Sepolia, native ETH. The agent's ERC 8004 registration is there, we hold
 * ETH there, and a native transfer needs no token faucet — one fewer external
 * dependency on the critical path of the gate that `docs/14` puts a hard
 * decision point on.
 */

import { formatEther, parseEther } from "viem";
import { requireServerEnv } from "@nymspace/core/env";
import type { Address, Hex } from "@nymspace/core";
import { chainConfig, createViemChainClient } from "@nymspace/ens";
import { PrivyClient, type PolicyLimit } from "@nymspace/privy";
import { Store, closeDatabase, database, migrate } from "@nymspace/store";

const ORGANIZATION_ID = "nymspace";
const AGENT_DB_ID = "agent-research";
const BASE_SEPOLIA = 84532;

/**
 * The seed limit only.
 *
 * A constant here and nowhere else: everything that *displays* a limit reads it
 * back from the live policy (task 5.9), and Gate C changes the policy and
 * requires the displayed value to follow. Seeding from a constant is fine;
 * rendering from one is the failure.
 */
const SEED_LIMIT_WEI = parseEther("0.001");

/**
 * The balance a full Gate C run needs, not merely one payment.
 *
 * The gate spends the denied amount once for real — assertion 4 raises the
 * limit and the identical request then executes — and must still hold more than
 * the denied amount afterwards, or the restore-and-deny step fails on funds
 * rather than on policy. That is precisely the boring explanation the gate is
 * built to eliminate, so the target is two denied amounts plus the allowed one
 * plus gas.
 *
 * A target rather than a one-shot transfer: the wallet is topped up to this
 * whenever it falls below, which is what makes Gate E's three consecutive runs
 * possible.
 */
const TARGET_BALANCE_WEI = parseEther("0.03");

//////////////////////////////////////////////////////////////////////////////

interface Step {
  what: string;
  ok: boolean;
  detail: string;
}

const steps: Step[] = [];

function step(entry: Step): Step {
  steps.push(entry);
  console.log(`${entry.ok ? "ok  " : "FAIL"}  ${entry.what.padEnd(40)} ${entry.detail}`);
  return entry;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0]! : String(error);
}

//////////////////////////////////////////////////////////////////////////////

async function main(): Promise<void> {
  const config = chainConfig();
  const keys = requireServerEnv([
    "ENSV2_ORGANIZATION_PRIVATE_KEY",
    "ENSV2_AGENT_CONTROLLER_PRIVATE_KEY",
    "DEMO_DENIED_PAYMENT_AMOUNT",
    "DEMO_ALLOWED_PAYMENT_AMOUNT",
  ] as const);

  const deniedWei = BigInt(keys.DEMO_DENIED_PAYMENT_AMOUNT);
  const allowedWei = BigInt(keys.DEMO_ALLOWED_PAYMENT_AMOUNT);

  // What one Gate C run consumes and must still have left over.
  const requiredWei = deniedWei * 2n + allowedWei;
  if (TARGET_BALANCE_WEI < requiredWei) {
    throw new Error(
      `Target balance ${TARGET_BALANCE_WEI} wei is below the ${requiredWei} wei a Gate C run needs ` +
        "(two denied amounts plus the allowed one). The gate would then fail on funds rather than on policy.",
    );
  }

  const privy = new PrivyClient();
  const db = database();
  await migrate(db);
  const store = new Store(db);

  const agent = await store.getAgent(AGENT_DB_ID);
  if (!agent) {
    throw new Error(`${AGENT_DB_ID} is not in the store. Run \`pnpm provision:fleet\` first.`);
  }

  console.log(`Provisioning a wallet for ${agent.ensName}\n`);

  //////////////////////////////////////////////////////////////////////////
  // 5.4 — exactly one amount-based control
  //////////////////////////////////////////////////////////////////////////

  const existingRef = await store.getFinancialAuthority(AGENT_DB_ID);
  let limit: PolicyLimit;

  if (existingRef?.policyId) {
    limit = await privy.getPolicyLimit(existingRef.policyId);
    step({
      what: "5.4 amount policy",
      ok: true,
      detail: `reusing ${limit.policyId}, limit ${formatEther(BigInt(limit.maxValueWei))} ETH`,
    });
  } else {
    limit = await privy.createAmountPolicy({
      name: `nymspace research max transfer`,
      maxValueWei: SEED_LIMIT_WEI,
    });
    step({
      what: "5.4 amount policy",
      ok: true,
      detail: `${limit.policyId}, limit ${formatEther(BigInt(limit.maxValueWei))} ETH`,
    });
  }

  //////////////////////////////////////////////////////////////////////////
  // 5.2 / 5.3 — the wallet, application-owned and governed from creation
  //////////////////////////////////////////////////////////////////////////

  let wallet;
  if (existingRef?.privyWalletId) {
    wallet = await privy.getWallet(existingRef.privyWalletId);
    step({
      what: "5.2 wallet",
      ok: true,
      detail: `reusing ${wallet.id} at ${wallet.address}`,
    });
  } else {
    wallet = await privy.createWallet({ policyIds: [limit.policyId] });
    step({
      what: "5.2 wallet",
      ok: true,
      detail: `${wallet.id} at ${wallet.address}`,
    });
  }

  // Governed, asserted rather than assumed. A wallet whose policy list does not
  // contain the policy is a wallet with no control on it, and every payment
  // below would then succeed for a reason nobody noticed.
  if (!wallet.policyIds.includes(limit.policyId)) {
    wallet = await privy.setWalletPolicies(wallet.id, [limit.policyId]);
  }
  step({
    what: "5.3 policy is attached to the wallet",
    ok: wallet.policyIds.includes(limit.policyId),
    detail: wallet.policyIds.includes(limit.policyId)
      ? `application-owned wallet enforcing ${limit.policyId}`
      : `wallet enforces ${JSON.stringify(wallet.policyIds)}, not ${limit.policyId}`,
  });

  // Only identifiers and an address. There is no field on this shape that key
  // material could go in, which is the capability spec's requirement.
  await store.putFinancialAuthority({
    agentId: AGENT_DB_ID,
    privyWalletId: wallet.id,
    walletAddress: wallet.address as Address,
    policyId: limit.policyId,
    policyLabel: limit.name,
  });
  await store.upsertAgent({
    id: AGENT_DB_ID,
    organizationId: ORGANIZATION_ID,
    slug: agent.slug,
    ensName: agent.ensName,
    controllerAddress: agent.controllerAddress,
    privyWalletId: wallet.id,
  });
  await store.setProvisioning(AGENT_DB_ID, { financial: "policy_configured" });

  await store.recordEvent({
    organizationId: ORGANIZATION_ID,
    agentId: AGENT_DB_ID,
    source: "privy",
    type: "privy.wallet.created",
    status: "success",
    occurredAt: new Date().toISOString(),
    summary: `Wallet ${wallet.address} under policy ${limit.policyId}`,
    evidence: { source: "privy", requestId: wallet.id },
    metadata: { policyLimitWei: limit.maxValueWei, policyLabel: limit.name },
  });

  //////////////////////////////////////////////////////////////////////////
  // 5.5 — fund it, above the denied amount
  //////////////////////////////////////////////////////////////////////////

  const chain = createViemChainClient({
    rpcUrl: process.env["BASE_SEPOLIA_RPC_URL"] ?? "https://sepolia.base.org",
    chainId: BASE_SEPOLIA,
    organizationKey: keys.ENSV2_ORGANIZATION_PRIVATE_KEY as Hex,
    controllerKey: keys.ENSV2_AGENT_CONTROLLER_PRIVATE_KEY as Hex,
  });

  const balance = await chain.getBalance(wallet.address as Address);
  if (balance >= requiredWei) {
    step({
      what: "5.5 wallet is funded",
      ok: true,
      detail: `${formatEther(balance)} ETH already, above the ${formatEther(requiredWei)} ETH a gate run needs`,
    });
  } else {
    const { createWalletClient, http } = await import("viem");
    const { privateKeyToAccount } = await import("viem/accounts");
    const { baseSepolia } = await import("viem/chains");

    const funder = createWalletClient({
      account: privateKeyToAccount(keys.ENSV2_ORGANIZATION_PRIVATE_KEY as Hex),
      chain: baseSepolia,
      transport: http(process.env["BASE_SEPOLIA_RPC_URL"] ?? "https://sepolia.base.org"),
    });

    // Top up to the target rather than sending a fixed amount, so a partially
    // drained wallet is refilled to exactly what the next run needs.
    const topUp = TARGET_BALANCE_WEI - balance;
    const hash = await funder.sendTransaction({
      to: wallet.address as Address,
      value: topUp,
    });
    await chain.waitForReceipt(hash);

    // Poll rather than read once. A confirmed receipt says the transfer is in a
    // block, not that the node the next read lands on has that block — the
    // first run of this script reported 0 ETH for a wallet that had 0.03, which
    // reads as a failed transfer rather than a stale replica.
    const after = await waitForBalanceAbove(
      (address) => chain.getBalance(address),
      wallet.address as Address,
      requiredWei - 1n,
    );
    step({
      what: "5.5 wallet is funded",
      ok: after >= requiredWei,
      detail: `${formatEther(after)} ETH after topping up ${formatEther(topUp)}, tx ${hash}`,
    });
  }

  //////////////////////////////////////////////////////////////////////////

  const failures = steps.filter((s) => !s.ok);
  console.log(`\n${steps.length - failures.length}/${steps.length} steps passed`);
  console.log(`\nSet PRIVY_POLICY_ID=${limit.policyId} in .env so the console reads the live limit.`);

  if (failures.length > 0) process.exitCode = 1;
  await closeDatabase();
}

/** Bounded polling for replica lag. Short, because this is not an outage. */
async function waitForBalanceAbove(
  read: (address: Address) => Promise<bigint>,
  address: Address,
  floor: bigint,
  attempts = 6,
  delayMs = 2000,
): Promise<bigint> {
  let balance = 0n;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    balance = await read(address);
    if (balance > floor) return balance;
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return balance;
}

main().catch(async (error: unknown) => {
  console.error(`wallet provisioning failed: ${messageOf(error)}`);
  process.exitCode = 1;
  await closeDatabase().catch(() => {});
});
