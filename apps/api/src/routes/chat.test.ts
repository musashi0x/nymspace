import { describe, expect, it } from "vitest";
import { CONSOLE_SUGGESTIONS } from "@nymspace/core";
import { createApp } from "../app";
import type { Deps } from "../deps";

/**
 * The chat's matcher, pinned where its order matters.
 *
 * Intents are regexes tried in sequence, and several questions name the same
 * agent and the same word. "what does research's mcp serve", "as research,
 * set its mcp endpoint to …" and "show research" differ only in which rule
 * reaches them first — so a reorder that answered one with another's plan
 * would compile and serve, and nothing but these tests would notice.
 */

const agent = {
  id: "agent-research",
  organizationId: "nymspace",
  slug: "research",
  ensName: "research.nymspace.eth",
  controllerAddress: "0xDEA25D2537cE06cE1073dd9621C70056CBDC3aEB",
  provisioning: {
    ens: "active",
    erc8004: "registered",
    ensip25: "verified",
    graph: "indexed",
    financial: "policy_configured",
  },
};

const ADDRESS = "0x0000000000000000000000000000000000000001";

/**
 * An ENS service that answers every read with nothing and records what it
 * was asked, so a test can say "the chat touched no chain" and mean it.
 */
function recordingEns(calls: string[]) {
  return new Proxy(
    {},
    {
      get(_, key) {
        return async () => {
          calls.push(String(key));
          if (key === "canSetText") return false;
          if (key === "findOwner" || key === "getResolver") return ADDRESS;
          return "";
        };
      },
    },
  ) as unknown as Deps["ens"];
}

/**
 * The wallet reference the fixture's agent carries, matching its own
 * `financial: "policy_configured"`. A payment plan is only offered when one
 * exists, so a store that answered `undefined` here would describe an agent
 * whose provisioning state and whose authority disagreed.
 */
const AUTHORITY = {
  agentId: agent.id,
  privyWalletId: "wallet-research",
  walletAddress: ADDRESS,
  policyId: "policy-research",
  policyLabel: "research spend limit",
};

function chatApp(
  calls: string[] = [],
  // `null`, not `undefined`: an explicit `undefined` argument selects the
  // default parameter, which would silently give the no-wallet test a wallet.
  authority: (Omit<typeof AUTHORITY, "policyId"> & { policyId?: string }) | null =
    AUTHORITY,
) {
  const deps = {
    store: {
      listAgents: async () => [agent],
      getAgent: async (id: string) => (id === agent.id ? agent : undefined),
      // The audit suggestion reads the log; an empty one is a valid trail.
      listActivity: async () => [],
      getFinancialAuthority: async () => authority ?? undefined,
    },
    ens: recordingEns(calls),
    config: { chainId: 11155111 },
    registry: ADDRESS,
    organization: ADDRESS,
    controller: agent.controllerAddress,
    parentName: "nymspace.eth",
  } as unknown as Deps;
  return createApp({ port: 0, allowedOrigins: [] }, deps);
}

async function ask(message: string, calls: string[] = []) {
  const res = await chatApp(calls).fetch(
    new Request("http://api.test/v1/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    }),
  );
  expect(res.status, message).toBe(200);
  return res.json();
}

describe("the MCP intent", () => {
  it("answers with an unsigned connect plan and performs no connect", async () => {
    const calls: string[] = [];
    const answer = await ask("what does research's mcp serve", calls);

    expect(answer).toMatchObject({
      kind: "plan",
      steps: [
        {
          method: "POST",
          path: "/v1/mcp/connect",
          body: { target: { kind: "fleet", agentId: "agent-research" } },
          actor: "none",
        },
      ],
    });
    expect(answer.steps).toHaveLength(1);
    // No ENS read: the endpoint is not even resolved until the plan is run.
    expect(calls).toEqual([]);
  });

  it("recognises the other ways the question is asked", async () => {
    for (const message of [
      "is research's mcp up",
      "what tools does research's mcp offer",
      "connect to research.nymspace.eth mcp",
    ]) {
      const answer = await ask(message);
      expect(answer.kind, message).toBe("plan");
      expect(answer.steps[0].path, message).toBe("/v1/mcp/connect");
    }
  });
});

describe("the questions it must not steal", () => {
  it("keeps an endpoint write a record-write plan", async () => {
    const answer = await ask("as research, set its mcp endpoint to https://example.com/mcp");
    expect(answer.kind).toBe("plan");
    expect(answer.steps[0].path).toBe("/v1/agents/agent-research/records");
    expect(answer.steps[0].actor).toBe("controller");
  });

  it("keeps a plain question about the agent the agent lens", async () => {
    const answer = await ask("show research");
    expect(answer.kind).toBe("lens");
    expect(answer.title).toBe("research.nymspace.eth");
  });
});

describe("the payment intent", () => {
  it("offers the two-step plan when the agent holds a wallet under a policy", async () => {
    const answer = await ask("pay 0.0001 ETH from research to research");

    expect(answer.kind).toBe("plan");
    expect(answer.steps.map((step: { path: string }) => step.path)).toEqual([
      "/v1/agents/agent-research/payments/preview",
      "/v1/agents/agent-research/payments",
    ]);
  });

  /**
   * The failure this pins: both steps 409 on the same missing reference, so an
   * unprovisioned agent used to get a plan promising a policy check and a
   * payment, then two identical red failures telling the operator to run a
   * `pnpm` script they have no checkout for.
   */
  it("offers no plan at all when the agent has no wallet", async () => {
    const res = await chatApp([], null).fetch(
      new Request("http://api.test/v1/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "pay 0.0001 ETH from research to research" }),
      }),
    );
    expect(res.status).toBe(200);
    const answer = await res.json();

    expect(answer.kind).toBe("unanswered");
    expect(answer.message).toContain("no wallet");
    // Not a denial: there is no policy here to refuse anything.
    expect(answer.message).not.toContain("denied");
    // And no instruction the reader cannot act on.
    expect(answer.message).not.toContain("pnpm");
  });

  it("offers no plan when the wallet carries no policy to be capped by", async () => {
    const res = await chatApp([], { ...AUTHORITY, policyId: undefined }).fetch(
      new Request("http://api.test/v1/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "pay 0.0001 ETH from research to research" }),
      }),
    );
    const answer = await res.json();

    expect(answer.kind).toBe("unanswered");
    expect(answer.message).toContain("no spend policy");
  });
});

describe("the suggestions", () => {
  it("offers only questions the matcher answers", async () => {
    // A suggestion the chat then refuses is worse than no suggestion (lens.ts).
    for (const suggestion of CONSOLE_SUGGESTIONS) {
      const answer = await ask(suggestion);
      expect(answer.kind, suggestion).not.toBe("unanswered");
    }
  });
});
