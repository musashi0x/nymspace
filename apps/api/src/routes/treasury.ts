import { Hono } from "hono";
import type { PolicyLimit } from "@nymspace/privy";
import { ORGANIZATION_ID, type DepsEnv } from "../deps";
import { signerMode, tokenPayload } from "./agents";
import { readAt } from "./shared";

/**
 * Every agent's financial authority, in one read.
 *
 * Wallet administration — who may spend, and how much per transaction — is one
 * of the B2B workflows `docs/08` names, and until this route it had no surface:
 * the answer existed only inside one frame on a single agent's page, two clicks
 * from the fleet, with no way to compare two agents at all.
 *
 * ## Why this is aggregated here rather than looped in the browser
 *
 * Not latency. `GET /:id/wallet` throws when `getPolicyLimit` fails — a Privy
 * error, a policy with no amount condition, a policy pinning a contract that
 * cannot be denominated — and the error handler turns all three into a generic
 * 500. A page looping that route has two options and both are wrong: fail the
 * whole screen because one agent's policy could not be read, or swallow it per
 * agent with `.catch(() => null)` and render *"not provisioned"* for an agent
 * that is provisioned and whose policy merely could not be read.
 *
 * That second one is the dangerous one. `no_wallet` and "we could not ask" are
 * opposite claims about an agent's authority, and the browser has no way to
 * tell them apart once the 500 has flattened them. Settling each agent here
 * lets the response carry a third state — {@link WalletView.status} of
 * `unavailable`, with the reason — which is the whole justification for the
 * extra route.
 *
 * ## One policy, read once
 *
 * `PRIVY_POLICY_ID` is a single deployment-wide variable and
 * `scripts/provision-wallet.ts` reuses an existing policy rather than minting
 * one per agent, so in practice the fleet shares one. Deduplicating by policy
 * id collapses the Privy calls to the number of distinct policies, and
 * `policiesRead` reports that number rather than leaving the reader to assume
 * it was one per agent.
 */

type WalletView =
  | {
      status: "provisioned";
      address: string;
      policy: {
        label: string;
        maxAmount: string;
        token: ReturnType<typeof tokenPayload>;
        ruleName: string;
      } | null;
    }
  | { status: "no_wallet" }
  /**
   * Privy was asked and did not answer usefully.
   *
   * Its own state, never folded into `no_wallet`. One says this agent has no
   * financial authority; the other says we do not currently know what its
   * authority is. Rendering the second as the first understates an agent's
   * power, which is the direction that matters.
   *
   * Carries the address, because we have it — the store answered, and only the
   * policy read failed. Dropping it here would make the screen say "no wallet
   * address" about a wallet whose address is sitting in the same object, which
   * is the understatement this state exists to prevent, one column over.
   */
  | { status: "unavailable"; address: string; reason: string };

export const treasury = new Hono<DepsEnv>().get("/", async (c) => {
  /**
   * `privy` is deliberately not destructured here.
   *
   * It is a lazy getter that constructs the client on first access and throws
   * when the credentials are absent — so naming it in this destructure would
   * invoke it, and an unconfigured deployment would get a 500 for the whole
   * screen. Which is the exact failure this route was written to avoid, one
   * level up from where it was expected: not one agent's policy failing, but
   * the client that reads every policy failing to exist.
   *
   * Reached inside `limitFor` instead, where the throw lands in the per-agent
   * catch and becomes `unavailable` on the rows that have a policy, while
   * agents with no wallet still correctly read `no_wallet`.
   */
  const { store, paymentToken } = c.var.deps;

  // Same shape: absent owner credentials are a product state, not an error.
  let hasOwner = false;
  try {
    hasOwner = c.var.deps.privyOwner !== undefined;
  } catch {
    hasOwner = false;
  }

  const agents = await store.listAgents(ORGANIZATION_ID);

  /**
   * One in-flight read per distinct policy, shared by every agent on it.
   *
   * Keyed by policy id and holding the promise rather than the result, so two
   * agents resolved concurrently join the same request instead of racing two.
   */
  const limits = new Map<string, Promise<PolicyLimit>>();
  const limitFor = (policyId: string) => {
    const existing = limits.get(policyId);
    if (existing) return existing;
    // Accessed here, not above: the getter throws when Privy is unconfigured.
    const pending = c.var.deps.privy.getPolicyLimit(policyId);
    limits.set(policyId, pending);
    return pending;
  };

  const rows = await Promise.all(
    agents.map(async (agent) => {
      const base = {
        id: agent.id,
        slug: agent.slug,
        ensName: agent.ensName,
        controllerAddress: agent.controllerAddress,
      };

      const ref = await store.getFinancialAuthority(agent.id);
      if (!ref?.walletAddress) {
        return { ...base, wallet: { status: "no_wallet" } as WalletView, readAt: readAt() };
      }

      if (!ref.policyId) {
        // A wallet with nothing constraining it. Provisioned, and worth saying
        // so plainly rather than reporting it beside the governed ones.
        return {
          ...base,
          wallet: {
            status: "provisioned",
            address: ref.walletAddress,
            policy: null,
          } as WalletView,
          readAt: readAt(),
        };
      }

      try {
        const limit = await limitFor(ref.policyId);
        return {
          ...base,
          wallet: {
            status: "provisioned",
            address: ref.walletAddress,
            policy: {
              label: ref.policyLabel ?? limit.name,
              maxAmount: limit.maxAmount.toString(),
              token: tokenPayload(limit.token),
              ruleName: limit.ruleName,
            },
          } as WalletView,
          readAt: readAt(),
        };
      } catch (error) {
        /*
          The first line only, never the provider's body.

          Same discipline as `describeDenial` in `shared.ts`: a Privy error body
          can carry policy internals, and `docs/10` is explicit that those do not
          go over the wire.
        */
        const message = error instanceof Error ? error.message : String(error);
        return {
          ...base,
          wallet: {
            status: "unavailable",
            address: ref.walletAddress,
            reason: message.split("\n")[0] ?? "unknown",
          } as WalletView,
          readAt: readAt(),
        };
      }
    }),
  );

  return c.json({
    agents: rows,
    token: tokenPayload(paymentToken),
    signerMode: signerMode(hasOwner),
    policiesRead: limits.size,
    /*
      Two systems, named as two. The address is the store's own reference; the
      limit was read from Privy during this request. `CLAUDE.md` is explicit
      that the store is not an authority, so a single "privy" label here would
      claim provenance the address does not have.
    */
    source: "store+privy" as const,
    readAt: readAt(),
  });
});
