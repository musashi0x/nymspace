import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import type { ApiConfig } from "../config";
import type { Deps } from "../deps";

/**
 * The three behaviours that justify this route existing at all.
 *
 * Each one is something a browser looping `GET /v1/agents/:id/wallet` cannot
 * do: keep a failed policy read distinguishable from an absent wallet, keep one
 * agent's failure off the other rows, and read a shared policy once.
 */

const config: ApiConfig = {
  port: 0,
  allowedOrigins: ["http://localhost:3111"],
};

function appWith(overrides: Partial<Deps>) {
  return createApp(config, overrides as Deps);
}

const agents = [
  { id: "agent-a", slug: "a", ensName: "a.nymspace.eth", controllerAddress: "0xA" },
  { id: "agent-b", slug: "b", ensName: "b.nymspace.eth", controllerAddress: "0xB" },
  { id: "agent-c", slug: "c", ensName: "c.nymspace.eth", controllerAddress: "0xC" },
];

const limit = {
  policyId: "pol_shared",
  name: "max transfer",
  maxAmount: 5_000_000n,
  token: { address: "0x036C", symbol: "USDC", decimals: 6 },
  ruleName: "transfer.amount lte",
};

/** a and b share one policy; c has no wallet at all. */
function store(authority: (id: string) => unknown) {
  return {
    listAgents: async () => agents,
    getFinancialAuthority: async (id: string) => authority(id),
  } as unknown as Deps["store"];
}

async function read(app: ReturnType<typeof appWith>) {
  const res = await app.fetch(new Request("http://api.test/v1/treasury"));
  return { status: res.status, body: (await res.json()) as any };
}

describe("GET /v1/treasury", () => {
  it("keeps an agent with no wallet distinct from one whose policy failed", async () => {
    let calls = 0;
    const { status, body } = await read(
      appWith({
        store: store((id) =>
          id === "agent-c"
            ? undefined
            : { walletAddress: `0xW${id}`, policyId: "pol_shared", policyLabel: "cap" },
        ),
        privy: {
          getPolicyLimit: async () => {
            calls += 1;
            // Every agent that has a policy shares this one failure.
            throw new Error("Privy 500\nsecond line that must not travel");
          },
        } as unknown as Deps["privy"],
        privyOwner: undefined,
        paymentToken: null,
      }),
    );

    expect(status).toBe(200);
    const byId = Object.fromEntries(body.agents.map((a: any) => [a.id, a.wallet]));

    expect(byId["agent-c"].status).toBe("no_wallet");
    expect(byId["agent-a"].status).toBe("unavailable");
    // The reason is the first line only — a provider body can carry policy
    // internals and `docs/10` keeps those off the wire.
    expect(byId["agent-a"].reason).toBe("Privy 500");
    expect(byId["agent-a"].reason).not.toContain("second line");
    /*
      And it still carries the address. The store answered; only Privy did not.
      Dropping it would leave the console with nothing to print in the wallet
      column for an agent that demonstrably has one, which is the same
      understatement of an agent's authority that `unavailable` exists to stop
      one column over.
    */
    expect(byId["agent-a"].address).toBe("0xWagent-a");
    expect(byId["agent-c"].address).toBeUndefined();
    expect(calls).toBe(1);
  });

  it("does not let one agent's Privy failure blank the others", async () => {
    const { body } = await read(
      appWith({
        store: store((id) => ({
          walletAddress: `0xW${id}`,
          policyId: id === "agent-b" ? "pol_broken" : "pol_shared",
          policyLabel: "cap",
        })),
        privy: {
          getPolicyLimit: async (policyId: string) => {
            if (policyId === "pol_broken") throw new Error("no lte condition");
            return limit;
          },
        } as unknown as Deps["privy"],
        privyOwner: undefined,
        paymentToken: null,
      }),
    );

    const byId = Object.fromEntries(body.agents.map((a: any) => [a.id, a.wallet]));
    expect(byId["agent-b"].status).toBe("unavailable");
    expect(byId["agent-a"].status).toBe("provisioned");
    expect(byId["agent-c"].status).toBe("provisioned");
    expect(byId["agent-a"].policy.maxAmount).toBe("5000000");
    expect(byId["agent-a"].policy.token.symbol).toBe("USDC");
  });

  it("reads a shared policy once, and says how many it read", async () => {
    let calls = 0;
    const { body } = await read(
      appWith({
        store: store((id) => ({
          walletAddress: `0xW${id}`,
          policyId: "pol_shared",
          policyLabel: "cap",
        })),
        privy: {
          getPolicyLimit: async () => {
            calls += 1;
            return limit;
          },
        } as unknown as Deps["privy"],
        privyOwner: undefined,
        paymentToken: null,
      }),
    );

    expect(calls).toBe(1);
    expect(body.policiesRead).toBe(1);
    expect(body.agents).toHaveLength(3);
  });

  it("reports a wallet with no policy as provisioned, not as governed", async () => {
    const { body } = await read(
      appWith({
        store: store(() => ({ walletAddress: "0xW", policyId: undefined })),
        privy: {
          getPolicyLimit: async () => {
            throw new Error("must not be called");
          },
        } as unknown as Deps["privy"],
        privyOwner: undefined,
        paymentToken: null,
      }),
    );

    expect(body.agents[0].wallet.status).toBe("provisioned");
    expect(body.agents[0].wallet.policy).toBeNull();
  });

  it("names the second signer only when an owner key is configured", async () => {
    const base = {
      store: store(() => undefined),
      privy: {} as unknown as Deps["privy"],
      paymentToken: null,
    };

    const without = await read(appWith({ ...base, privyOwner: undefined }));
    expect(without.body.signerMode).not.toContain("escalate");

    const withOwner = await read(
      appWith({ ...base, privyOwner: {} as unknown as Deps["privyOwner"] }),
    );
    expect(withOwner.body.signerMode).toContain("escalate");
  });
});
