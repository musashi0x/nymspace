import { describe, expect, it } from "vitest";
import type { Address, Hex } from "@nymspace/core";
import {
  GAS_FLOOR_WEI,
  GAS_TARGET_WEI,
  provisionWallet,
  type WalletContext,
} from "./financial";

/**
 * The property under test is the one `provisioning.test.ts` asserts for names:
 * a re-run spends nothing it already spent. Here that means no second policy,
 * no second wallet, and no gas beyond what the wallet is short — and, because
 * this is the route that hands an agent money, that the policy exists before
 * the wallet does.
 */

const WALLET_ADDRESS = "0x7777777777777777777777777777777777777777" as Address;
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;
const HASH = `0x${"b".repeat(64)}` as Hex;

interface Policy {
  policyId: string;
  name: string;
  maxAmount: bigint;
  token: { address: Address; symbol: string; decimals: number } | null;
  ruleName: string;
}

interface Wallet {
  id: string;
  address: Address;
  policyIds: string[];
}

function fakes(
  options: { balance?: bigint; funder?: boolean; financial?: string } = {},
) {
  const order: string[] = [];
  const sent: bigint[] = [];
  const policies = new Map<string, Policy>();
  const wallets = new Map<string, Wallet>();
  const ref: { current?: Record<string, unknown> } = {};

  const row = {
    id: "agent-demo1",
    organizationId: "nymspace",
    slug: "demo1",
    ensName: "demo1.nymspace.eth",
    controllerAddress: "0x2222222222222222222222222222222222222222",
    provisioning: { financial: options.financial ?? "no_wallet" } as Record<string, string>,
  };

  const store = {
    getAgent: async () => row,
    getFinancialAuthority: async () => ref.current,
    putFinancialAuthority: async (value: Record<string, unknown>) => {
      ref.current = value;
      return value;
    },
    upsertAgent: async () => undefined,
    setProvisioning: async (_id: string, patch: Record<string, string>) => {
      Object.assign(row.provisioning, patch);
      return row.provisioning;
    },
    recordEvent: async () => undefined,
  };

  const privy = {
    createAmountPolicy: async ({ name, maxValueWei }: { name: string; maxValueWei: bigint }) => {
      order.push("policy");
      const policy = {
        policyId: `pol-${policies.size + 1}`,
        name,
        maxAmount: maxValueWei,
        token: null,
        ruleName: "native",
      };
      policies.set(policy.policyId, policy);
      return policy;
    },
    createTokenPolicy: async () => {
      throw new Error("not under test");
    },
    getPolicyLimit: async (id: string) => policies.get(id)!,
    createWallet: async ({ policyIds }: { policyIds?: string[] }) => {
      order.push("wallet");
      const wallet = {
        id: `wallet-${wallets.size + 1}`,
        address: WALLET_ADDRESS,
        policyIds: policyIds ?? [],
      };
      wallets.set(wallet.id, wallet);
      return wallet;
    },
    getWallet: async (id: string) => wallets.get(id)!,
    setWalletPolicies: async (id: string, policyIds: string[]) => {
      const wallet = { ...wallets.get(id)!, policyIds };
      wallets.set(id, wallet);
      return wallet;
    },
  };

  let balance = options.balance ?? 0n;
  const funder = {
    getBalance: async () => balance,
    sendValue: async (_to: Address, value: bigint) => {
      sent.push(value);
      balance += value;
      return HASH;
    },
    waitForReceipt: async () => ({ status: "success" as const }),
  };

  const context = {
    privy,
    store,
    organizationId: "nymspace",
    token: null,
    ...(options.funder !== false && { funder }),
  } as unknown as WalletContext;

  return { context, order, sent, policies, ref, row };
}

describe("provisionWallet", () => {
  it("creates the policy before the wallet, attaches it, and funds gas to the target", async () => {
    const { context, order, sent, ref, policies } = fakes();

    const result = await provisionWallet(context, "agent-demo1");

    expect(order).toEqual(["policy", "wallet"]);
    // 0.001 ETH on the native path, not ten of it.
    expect(policies.get("pol-1")?.maxAmount).toBe(10n ** 15n);
    expect(result.financial).toBe("policy_configured");
    expect(result.address).toBe(WALLET_ADDRESS);
    expect(ref.current).toMatchObject({ privyWalletId: "wallet-1", policyId: "pol-1" });
    expect(sent).toEqual([GAS_TARGET_WEI]);
    expect(result.steps.every((s) => s.ok)).toBe(true);
  });

  it("spends nothing on a re-run", async () => {
    const { context, order, sent } = fakes();

    await provisionWallet(context, "agent-demo1");
    const again = await provisionWallet(context, "agent-demo1");

    expect(order).toEqual(["policy", "wallet"]);
    expect(sent).toHaveLength(1);
    // Policy, wallet and gas each report why they spent nothing; the
    // attachment is a read, and is reported as one.
    expect(again.steps.filter((s) => s.skipped).map((s) => s.what)).toEqual([
      "policy",
      "wallet",
      "gas",
    ]);
  });

  it("tops up only what the wallet is short", async () => {
    const low = GAS_FLOOR_WEI / 2n;
    const { context, sent } = fakes({ balance: low });

    await provisionWallet(context, "agent-demo1");

    expect(sent).toEqual([GAS_TARGET_WEI - low]);
  });

  it("leaves gas unfunded, and says so, with no organization key", async () => {
    const { context, sent } = fakes({ funder: false });

    const result = await provisionWallet(context, "agent-demo1");

    expect(result.financial).toBe("policy_configured");
    expect(sent).toEqual([]);
    expect(result.steps.at(-1)).toMatchObject({ what: "gas", ok: false, skipped: true });
  });

  it("refuses a stored policy denominated in another token", async () => {
    const { context, order, policies, ref } = fakes();
    policies.set("pol-usdc", {
      policyId: "pol-usdc",
      name: "old",
      maxAmount: 10n,
      token: { address: USDC, symbol: "USDC", decimals: 6 },
      ruleName: "token",
    });
    ref.current = { agentId: "agent-demo1", policyId: "pol-usdc" };

    const result = await provisionWallet(context, "agent-demo1");

    expect(result.financial).toBe("failed");
    expect(order).toEqual([]);
  });

  it("never downgrades an agent that has already paid", async () => {
    const { context } = fakes({ financial: "financially_active" });

    const result = await provisionWallet(context, "agent-demo1");

    expect(result.financial).toBe("financially_active");
  });
});
