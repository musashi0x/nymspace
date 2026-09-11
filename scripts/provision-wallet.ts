/**
 * Give the research agent a wallet under one enforceable policy — tasks 5.2
 * through 5.5.
 *
 * Run: pnpm provision:wallet
 *
 * The order is the point. The policy is created before the wallet so the wallet
 * is governed from its first block rather than from whenever an attach call
 * happened to land; funding comes last, above what a whole Gate C run spends,
 * so that the gate's denial cannot be explained by an empty balance.
 *
 * Base Sepolia. The agent's ERC 8004 registration is there, we hold ETH there
 * for gas, and the demo pays in the token named by `DEMO_PAYMENT_TOKEN_ADDRESS`
 * — USDC, per `docs/08`. With no token configured the script falls back to the
 * native-ETH control, which is the arrangement Gate C first passed under and
 * the fallback the cut line names.
 *
 * Splitting the wallet's authority between an owner key and the agent's signer
 * is `pnpm provision:signers`, deliberately separate: it is a one-time change
 * that makes every later request require a signature.
 */

import { formatEther, parseEther } from "viem";
import { requireServerEnv } from "@nymspace/core/env";
import { formatAmount, toBaseUnits, type Address, type Hex } from "@nymspace/core";
import { chainConfig, createViemChainClient } from "@nymspace/ens";
import {
  PrivyClient,
  agentSignerKey,
  demoToken,
  type PolicyLimit,
} from "@nymspace/privy";
import { Store, closeDatabase, database, migrate } from "@nymspace/store";

const ORGANIZATION_ID = "nymspace";
const AGENT_DB_ID = "agent-research";
const BASE_SEPOLIA = 84532;

/**
 * The seed limit only — ten of whatever the demo pays in.
 *
 * A constant here and nowhere else: everything that *displays* a limit reads it
 * back from the live policy (task 5.9), and Gate C changes the policy and
 * requires the displayed value to follow. Seeding from a constant is fine;
 * rendering from one is the failure. `docs/08`'s example policy says ten, and
 * the demo's allowed payment is five.
 */
const SEED_LIMIT_UNITS = "10";

/**
 * Gas, not the payment.
 *
 * An ERC 20 transfer is not gasless, so the wallet still needs native ETH —
 * but it no longer needs to *hold* the demo amounts in ETH, which is why this
 * target is a flat allowance rather than a multiple of them. The token balance
 * is checked separately below and cannot be topped up from here: test USDC
 * comes from Circle's faucet.
 */
const GAS_TARGET_WEI = parseEther("0.01");

/** Twenty transfers' worth of headroom, so Gate E's repeat runs do not stall. */
const GAS_FLOOR_WEI = parseEther("0.002");

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

const BALANCE_OF = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

//////////////////////////////////////////////////////////////////////////////

async function main(): Promise<void> {
  chainConfig();
  const keys = requireServerEnv([
    "ENSV2_ORGANIZATION_PRIVATE_KEY",
    "ENSV2_AGENT_CONTROLLER_PRIVATE_KEY",
    "DEMO_DENIED_PAYMENT_AMOUNT",
    "DEMO_ALLOWED_PAYMENT_AMOUNT",
  ] as const);

  const token = demoToken();
  const denied = BigInt(keys.DEMO_DENIED_PAYMENT_AMOUNT);
  const allowed = BigInt(keys.DEMO_ALLOWED_PAYMENT_AMOUNT);
  const seedLimit = toBaseUnits(SEED_LIMIT_UNITS, token);

  /**
   * What one Gate C run consumes and must still have left over: the denied
   * amount twice — assertion 4 raises the limit and the identical request then
   * executes — plus the allowed one.
   */
  const runFloor = denied * 2n + allowed;

  if (!(allowed <= seedLimit && seedLimit < denied)) {
    throw new Error(
      `The three demo amounts do not bracket the seed limit: allowed ${formatAmount(allowed, token)} ` +
        `must be at or below ${formatAmount(seedLimit, token)}, which must be below denied ${formatAmount(denied, token)}. ` +
        "Out of that order the gate proves nothing — it either denies everything or allows everything.",
    );
  }

  const privy = new PrivyClient({ authorizationKey: agentSignerKey() });
  const db = database();
  await migrate(db);
  const store = new Store(db);

  const agent = await store.getAgent(AGENT_DB_ID);
  if (!agent) {
    throw new Error(`${AGENT_DB_ID} is not in the store. Run \`pnpm provision:fleet\` first.`);
  }

  console.log(
    `Provisioning a wallet for ${agent.ensName}, paying in ${token?.symbol ?? "native ETH"}\n`,
  );

  //////////////////////////////////////////////////////////////////////////
  // 5.4 — exactly one control, on the token and the amount
  //////////////////////////////////////////////////////////////////////////

  const existingRef = await store.getFinancialAuthority(AGENT_DB_ID);
  let limit: PolicyLimit;

  if (existingRef?.policyId) {
    limit = await privy.getPolicyLimit(existingRef.policyId);

    /**
     * A policy denominated in something other than what this deployment pays
     * in is not reusable, and quietly reusing it is how the demo ends up
     * capping ETH while transferring USDC — a limit on screen that governs a
     * transaction nobody is sending.
     */
    if ((limit.token?.address ?? null) !== (token?.address ?? null)) {
      throw new Error(
        `Policy ${limit.policyId} constrains ${limit.token?.symbol ?? "native ETH"} but this ` +
          `deployment pays in ${token?.symbol ?? "native ETH"}. Clear the agent's financial ` +
          "authority row to provision a new policy, rather than running with one that " +
          "constrains a transaction the demo never sends.",
      );
    }

    step({
      what: "5.4 policy",
      ok: true,
      detail: `reusing ${limit.policyId}, limit ${formatAmount(limit.maxAmount, limit.token)}`,
    });
  } else {
    limit = token
      ? await privy.createTokenPolicy({
          name: "nymspace research max transfer",
          token,
          maxAmount: seedLimit,
        })
      : await privy.createAmountPolicy({
          name: "nymspace research max transfer",
          maxValueWei: seedLimit,
        });
    step({
      what: "5.4 policy",
      ok: true,
      detail: `${limit.policyId}, limit ${formatAmount(limit.maxAmount, limit.token)}`,
    });
  }

  //////////////////////////////////////////////////////////////////////////
  // 5.2 / 5.3 — the wallet, governed from creation
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

  /**
   * Governed, asserted rather than assumed.
   *
   * The wallet-level policy is the floor: it binds every signer, including the
   * app's own credentials. `pnpm provision:signers` adds the per-signer split
   * on top, which is what makes the cap *the agent's* — but a wallet whose
   * policy list is empty has no control on it at all, and every payment below
   * would then succeed for a reason nobody noticed.
   */
  if (!wallet.policyIds.includes(limit.policyId)) {
    wallet = await privy.setWalletPolicies(wallet.id, [limit.policyId]);
  }
  step({
    what: "5.3 policy is attached to the wallet",
    ok: wallet.policyIds.includes(limit.policyId),
    detail: wallet.policyIds.includes(limit.policyId)
      ? `wallet enforcing ${limit.policyId}${wallet.ownerId ? `, owned by ${wallet.ownerId}` : ", no owner set"}`
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
    metadata: {
      policyLimit: limit.maxAmount,
      policyLabel: limit.name,
      tokenSymbol: limit.token?.symbol ?? "ETH",
      tokenAddress: limit.token?.address ?? null,
    },
  });

  //////////////////////////////////////////////////////////////////////////
  // 5.5 — gas from us, the demo token from the faucet
  //////////////////////////////////////////////////////////////////////////

  const chain = createViemChainClient({
    rpcUrl: process.env["BASE_SEPOLIA_RPC_URL"] ?? "https://sepolia.base.org",
    chainId: BASE_SEPOLIA,
    organizationKey: keys.ENSV2_ORGANIZATION_PRIVATE_KEY as Hex,
    controllerKey: keys.ENSV2_AGENT_CONTROLLER_PRIVATE_KEY as Hex,
  });

  const gasBalance = await chain.getBalance(wallet.address as Address);
  if (gasBalance >= GAS_FLOOR_WEI) {
    step({
      what: "5.5 gas",
      ok: true,
      detail: `${formatEther(gasBalance)} ETH, above the ${formatEther(GAS_FLOOR_WEI)} ETH floor`,
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
    const topUp = GAS_TARGET_WEI - gasBalance;
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
      GAS_FLOOR_WEI - 1n,
    );
    step({
      what: "5.5 gas",
      ok: after >= GAS_FLOOR_WEI,
      detail: `${formatEther(after)} ETH after topping up ${formatEther(topUp)}, tx ${hash}`,
    });
  }

  /**
   * The token balance is read, reported, and never topped up.
   *
   * There is no key here that mints test USDC, so an under-funded wallet is a
   * message rather than a transfer — and it has to be an explicit one, because
   * the way it fails otherwise is Gate C's denial happening on chain for want
   * of funds instead of in the enclave for want of permission. Those two look
   * identical in the console and mean opposite things.
   */
  if (token) {
    const { createPublicClient, http } = await import("viem");
    const { baseSepolia } = await import("viem/chains");
    const reader = createPublicClient({
      chain: baseSepolia,
      transport: http(process.env["BASE_SEPOLIA_RPC_URL"] ?? "https://sepolia.base.org"),
    });

    const held = (await reader.readContract({
      address: token.address,
      abi: BALANCE_OF,
      functionName: "balanceOf",
      args: [wallet.address as Address],
    })) as bigint;

    step({
      what: "5.5 demo token",
      ok: held >= runFloor,
      detail:
        held >= runFloor
          ? `${formatAmount(held, token)} held, above the ${formatAmount(runFloor, token)} a gate run spends`
          : `${formatAmount(held, token)} held, below the ${formatAmount(runFloor, token)} a gate run spends — ` +
            `send ${token.symbol} on Base Sepolia to ${wallet.address} (faucet.circle.com)`,
    });
  }

  //////////////////////////////////////////////////////////////////////////

  const failures = steps.filter((s) => !s.ok);
  console.log(`\n${steps.length - failures.length}/${steps.length} steps passed`);
  console.log(`\nSet PRIVY_POLICY_ID=${limit.policyId} in .env so the console reads the live limit.`);
  console.log(
    "Then run `pnpm provision:signers` to move the cap onto the agent's own key.",
  );

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
