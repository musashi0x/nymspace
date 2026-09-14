import { formatAmount, toBaseUnits, type Address, type Hex } from "@nymspace/core";
import type { ViemChainClient } from "@nymspace/ens";
import type { PolicyLimit, PrivyClient, TokenSpec } from "@nymspace/privy";
import type { FinancialProvisioning, Store } from "@nymspace/store";
import type { ProvisionStep } from "./provisioning";

/**
 * One agent's financial authority: a policy, a wallet governed by it from its
 * first block, and gas to spend with.
 *
 * Tasks 5.2 to 5.5 of `scripts/provision-wallet.ts` with the fleet default
 * removed, so `POST /v1/agents/:id/wallet` and the script run one sequence —
 * the argument design D7 made for `provisionAgent`. The script keeps what is
 * Gate C's alone: bracketing the demo amounts around the seed limit, and the
 * token balance a gate run needs.
 *
 * Not part of creating an agent, deliberately. Every step there spends gas to
 * say who an agent is; this one hands an agent money. It runs when an operator
 * asks, behind the same write token, never as a side effect of registering a
 * name.
 *
 * Idempotent on the store's reference: an agent with a policy and a wallet
 * reuses both, and gas is topped up to a target rather than sent as a fixed
 * amount, so a re-run spends only what the wallet is short.
 */

/** Ten of whatever the deployment pays in — the seed the script has always used. */
export const SEED_LIMIT_UNITS = "10";

/** 0.01 ETH, the balance a top-up fills to. An ERC 20 transfer still costs gas. */
export const GAS_TARGET_WEI = 10n ** 16n;

/** 0.002 ETH, about twenty transfers. At or above it, nothing is sent. */
export const GAS_FLOOR_WEI = 2n * 10n ** 15n;

/** The organization's account on the wallet's chain, as far as gas needs it. */
export interface GasFunder {
  getBalance(address: Address): Promise<bigint>;
  sendValue(to: Address, value: bigint): Promise<Hex>;
  waitForReceipt(hash: Hex): Promise<{ status: "success" | "reverted" }>;
}

/** A {@link GasFunder} over the viem client, always sending as the organization. */
export function funderFrom(
  chain: Pick<ViemChainClient, "getBalance" | "sendValue" | "waitForReceipt">,
): GasFunder {
  return {
    getBalance: (address) => chain.getBalance(address),
    sendValue: (to, value) => chain.sendValue({ to, value, as: "organization" }),
    waitForReceipt: (hash) => chain.waitForReceipt(hash),
  };
}

export type WalletPort = Pick<
  PrivyClient,
  | "getPolicyLimit"
  | "createTokenPolicy"
  | "createAmountPolicy"
  | "getWallet"
  | "createWallet"
  | "setWalletPolicies"
>;

export interface WalletContext {
  privy: WalletPort;
  store: Store;
  organizationId: string;
  /** What payments are denominated in. `null` is native ETH. */
  token: TokenSpec | null;
  /**
   * Absent on a deployment with no organization key. The wallet and policy are
   * still created — Privy needs no chain key for either — and the gas step
   * says the wallet was left unfunded rather than pretending it was not asked.
   */
  funder?: GasFunder;
}

export interface WalletResult {
  steps: ProvisionStep[];
  financial: FinancialProvisioning;
  walletId?: string;
  address?: Address;
  policyId?: string;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0]! : String(error);
}

export async function provisionWallet(
  ctx: WalletContext,
  agentId: string,
): Promise<WalletResult> {
  const { privy, store, token } = ctx;
  const steps: ProvisionStep[] = [];

  const step = (entry: ProvisionStep): ProvisionStep => {
    steps.push(entry);
    return entry;
  };

  const agent = await store.getAgent(agentId);
  if (!agent) {
    throw new Error(`${agentId} is not in the store. Provision its name first.`);
  }
  const existing = await store.getFinancialAuthority(agentId);

  const fail = async (): Promise<WalletResult> => {
    await store.setProvisioning(agentId, { financial: "failed" });
    return { steps, financial: "failed" };
  };

  //////////////////////////////////////////////////////////////////////////
  // 5.4 — exactly one control, on the token and the amount
  //////////////////////////////////////////////////////////////////////////

  let limit: PolicyLimit;
  let created = false;

  try {
    if (existing?.policyId) {
      limit = await privy.getPolicyLimit(existing.policyId);

      /*
        A policy denominated in something other than what this deployment pays
        in is not reusable. Reusing it quietly is how a screen ends up capping
        ETH while the agent transfers USDC — a limit that governs a transaction
        nobody sends.
      */
      if ((limit.token?.address ?? null) !== (token?.address ?? null)) {
        step({
          what: "policy",
          ok: false,
          skipped: true,
          detail:
            `${limit.policyId} constrains ${limit.token?.symbol ?? "native ETH"} but this ` +
            `deployment pays in ${token?.symbol ?? "native ETH"}. Clear the agent's ` +
            "financial authority to provision a new one.",
        });
        return fail();
      }

      step({
        what: "policy",
        ok: true,
        skipped: true,
        detail: `reusing ${limit.policyId}, limit ${formatAmount(limit.maxAmount, limit.token)}`,
        readBack: limit.policyId,
      });
    } else {
      const name = `nymspace ${agent.slug} max transfer`;
      const seed = toBaseUnits(SEED_LIMIT_UNITS, token);
      limit = token
        ? await privy.createTokenPolicy({ name, token, maxAmount: seed })
        : await privy.createAmountPolicy({ name, maxValueWei: seed });
      created = true;

      step({
        what: "policy",
        ok: true,
        skipped: false,
        detail: `${limit.policyId}, limit ${formatAmount(limit.maxAmount, limit.token)}`,
        readBack: limit.policyId,
      });
    }
  } catch (error) {
    step({ what: "policy", ok: false, skipped: false, detail: messageOf(error) });
    return fail();
  }

  //////////////////////////////////////////////////////////////////////////
  // 5.2 / 5.3 — the wallet, governed from creation
  //////////////////////////////////////////////////////////////////////////

  let wallet: Awaited<ReturnType<WalletPort["getWallet"]>>;

  try {
    if (existing?.privyWalletId) {
      wallet = await privy.getWallet(existing.privyWalletId);
      step({
        what: "wallet",
        ok: true,
        skipped: true,
        detail: `reusing ${wallet.id} at ${wallet.address}`,
        readBack: wallet.address,
      });
    } else {
      // The policy first, then the wallet under it, so there is no block in
      // which the wallet exists and nothing constrains it.
      wallet = await privy.createWallet({ policyIds: [limit.policyId] });
      created = true;

      // Before anything else can fail. A wallet Privy holds and the store
      // never heard of is a second wallet on the next run.
      await store.putFinancialAuthority({
        agentId,
        privyWalletId: wallet.id,
        walletAddress: wallet.address as Address,
        policyId: limit.policyId,
        policyLabel: limit.name,
      });

      step({
        what: "wallet",
        ok: true,
        skipped: false,
        detail: `${wallet.id} at ${wallet.address}`,
        readBack: wallet.address,
      });
    }

    if (!wallet.policyIds.includes(limit.policyId)) {
      wallet = await privy.setWalletPolicies(wallet.id, [limit.policyId]);
    }
  } catch (error) {
    step({ what: "wallet", ok: false, skipped: false, detail: messageOf(error) });
    return fail();
  }

  /*
    Governed, asserted rather than assumed. The wallet-level policy binds every
    signer, the app's own credentials included; a wallet whose policy list is
    empty has no control at all, and every payment would succeed for a reason
    nobody noticed.
  */
  const governed = wallet.policyIds.includes(limit.policyId);
  step({
    what: "policy attached",
    ok: governed,
    skipped: false,
    detail: governed
      ? `wallet enforcing ${limit.policyId}${wallet.ownerId ? `, owned by ${wallet.ownerId}` : ", no owner set"}`
      : `wallet enforces ${JSON.stringify(wallet.policyIds)}, not ${limit.policyId}`,
    readBack: wallet.policyIds.join(", ") || "no policy",
  });
  if (!governed) return fail();

  // Only identifiers and an address. There is no field on this shape that key
  // material could go in, which is the capability spec's requirement.
  const address = wallet.address as Address;
  await store.putFinancialAuthority({
    agentId,
    privyWalletId: wallet.id,
    walletAddress: address,
    policyId: limit.policyId,
    policyLabel: limit.name,
  });
  await store.upsertAgent({
    id: agent.id,
    organizationId: agent.organizationId,
    slug: agent.slug,
    ensName: agent.ensName,
    controllerAddress: agent.controllerAddress,
    privyWalletId: wallet.id,
  });

  /*
    `policy_configured`, and never a downgrade. `financially_active` means a
    payment has gone through under the policy — `verify-policy.ts` proves one —
    and re-provisioning an agent that got there does not undo that.
  */
  const financial: FinancialProvisioning =
    agent.provisioning.financial === "financially_active"
      ? "financially_active"
      : "policy_configured";
  await store.setProvisioning(agentId, { financial });

  if (created) {
    await store.recordEvent({
      organizationId: ctx.organizationId,
      agentId,
      source: "privy",
      type: "privy.wallet.created",
      status: "success",
      occurredAt: new Date().toISOString(),
      summary: `Wallet ${address} under policy ${limit.policyId}`,
      evidence: { source: "privy", requestId: wallet.id },
      metadata: {
        policyLimit: limit.maxAmount.toString(),
        policyLabel: limit.name,
        tokenSymbol: limit.token?.symbol ?? "ETH",
        tokenAddress: limit.token?.address ?? null,
      },
    });
  }

  //////////////////////////////////////////////////////////////////////////
  // 5.5 — gas from the organization; the token is never topped up here
  //////////////////////////////////////////////////////////////////////////

  if (!ctx.funder) {
    step({
      what: "gas",
      ok: false,
      skipped: true,
      detail: "no organization key configured, so the wallet was not funded and cannot pay gas",
    });
  } else {
    try {
      const balance = await ctx.funder.getBalance(address);
      if (balance >= GAS_FLOOR_WEI) {
        step({
          what: "gas",
          ok: true,
          skipped: true,
          detail: `${formatAmount(balance, null)}, above the ${formatAmount(GAS_FLOOR_WEI, null)} floor`,
          readBack: formatAmount(balance, null),
        });
      } else {
        // To the target, not a fixed amount: a drained wallet is refilled to
        // exactly what the next run needs, and no more.
        const topUp = GAS_TARGET_WEI - balance;
        const hash = await ctx.funder.sendValue(address, topUp);
        const receipt = await ctx.funder.waitForReceipt(hash);
        const after = await waitForBalanceAbove(ctx.funder, address, GAS_FLOOR_WEI - 1n);

        step({
          what: "gas",
          ok: receipt.status === "success" && after >= GAS_FLOOR_WEI,
          skipped: false,
          detail: `topped up ${formatAmount(topUp, null)}, tx ${hash}`,
          txHash: hash,
          readBack: formatAmount(after, null),
        });
      }
    } catch (error) {
      // The wallet and its policy stand; only the gas is missing, and a re-run
      // tops it up without touching either.
      step({ what: "gas", ok: false, skipped: false, detail: messageOf(error) });
    }
  }

  return {
    steps,
    financial,
    walletId: wallet.id,
    address,
    policyId: limit.policyId,
  };
}

/**
 * Bounded polling for replica lag. A confirmed receipt says the transfer is in
 * a block, not that the node the next read lands on has it — the script's
 * first run reported 0 ETH for a wallet holding 0.03.
 */
async function waitForBalanceAbove(
  funder: GasFunder,
  address: Address,
  floor: bigint,
  attempts = 6,
  delayMs = 2000,
): Promise<bigint> {
  let balance = 0n;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    balance = await funder.getBalance(address);
    if (balance > floor) return balance;
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return balance;
}
