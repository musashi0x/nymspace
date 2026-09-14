/**
 * Give an agent a wallet under one enforceable policy — tasks 5.2 through 5.5.
 *
 * Run: pnpm provision:wallet [agent-id]     (defaults to agent-research)
 *
 * The sequence is `provisionWallet` in `apps/api/src/financial.ts`, the same
 * one `POST /v1/agents/:id/wallet` runs: the policy before the wallet, so the
 * wallet is governed from its first block, and gas topped up last. What stays
 * here is Gate C's alone: the demo amounts must bracket the seed limit, and the
 * token balance must cover a gate run. Neither means anything for an agent
 * that is not about to be gated.
 *
 * Base Sepolia. The agent's ERC 8004 registration is there, we hold ETH there
 * for gas, and the demo pays in the token named by `DEMO_PAYMENT_TOKEN_ADDRESS`
 * — USDC, per `docs/08`. With no token configured the policy falls back to the
 * native-ETH control, which is the arrangement Gate C first passed under and
 * the fallback the cut line names.
 *
 * Splitting the wallet's authority between an owner key and the agent's signer
 * is `pnpm provision:signers`, deliberately separate: it is a one-time change
 * that makes every later request require a signature.
 */

import {
  funderFrom,
  provisionWallet,
  seedLimitFor,
} from "@nymspace/api/financial";
import { requireServerEnv } from "@nymspace/core/env";
import { formatAmount, type Address, type Hex } from "@nymspace/core";
import { chainConfig, createViemChainClient } from "@nymspace/ens";
import { PrivyClient, agentSignerKey, demoToken } from "@nymspace/privy";
import { Store, closeDatabase, database, migrate } from "@nymspace/store";

const ORGANIZATION_ID = "nymspace";
/**
 * Which agent gets the wallet.
 *
 * An argument rather than a constant, and the default keeps every existing
 * invocation behaving as it did. It was hardcoded to `agent-research`, which
 * meant a second funded agent could not be created at all — and without one,
 * "pay agent A from agent B" is a sentence this product can describe and never
 * demonstrate. Every peer shares one controller address, so the only address
 * that identifies a payee is a wallet of its own.
 */
const AGENT_DB_ID = process.argv[2] ?? "agent-research";
const BASE_SEPOLIA = 84532;

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
  const seedLimit = seedLimitFor(token);

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

  const chain = createViemChainClient({
    rpcUrl: process.env["BASE_SEPOLIA_RPC_URL"] ?? "https://sepolia.base.org",
    chainId: BASE_SEPOLIA,
    organizationKey: keys.ENSV2_ORGANIZATION_PRIVATE_KEY as Hex,
    controllerKey: keys.ENSV2_AGENT_CONTROLLER_PRIVATE_KEY as Hex,
  });

  //////////////////////////////////////////////////////////////////////////
  // 5.2 – 5.5 — the steps `POST /v1/agents/:id/wallet` runs too
  //////////////////////////////////////////////////////////////////////////

  const result = await provisionWallet(
    {
      privy,
      store,
      organizationId: ORGANIZATION_ID,
      token,
      funder: funderFrom(chain),
    },
    AGENT_DB_ID,
  );

  for (const entry of result.steps) {
    step({
      what: entry.what,
      ok: entry.ok,
      detail: entry.ok && entry.skipped ? `${entry.detail} (no spend)` : entry.detail,
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
  if (token && result.address) {
    const held = (await chain.readContract({
      address: token.address,
      abi: BALANCE_OF,
      functionName: "balanceOf",
      args: [result.address as Address],
    })) as bigint;

    step({
      what: "5.5 demo token",
      ok: held >= runFloor,
      detail:
        held >= runFloor
          ? `${formatAmount(held, token)} held, above the ${formatAmount(runFloor, token)} a gate run spends`
          : `${formatAmount(held, token)} held, below the ${formatAmount(runFloor, token)} a gate run spends — ` +
            `send ${token.symbol} on Base Sepolia to ${result.address} (faucet.circle.com)`,
    });
  }

  //////////////////////////////////////////////////////////////////////////

  const failures = steps.filter((s) => !s.ok);
  console.log(`\n${steps.length - failures.length}/${steps.length} steps passed`);
  if (result.policyId) {
    console.log(`\nSet PRIVY_POLICY_ID=${result.policyId} in .env so the console reads the live limit.`);
  }
  console.log(
    "Then run `pnpm provision:signers` to move the cap onto the agent's own key.",
  );

  if (failures.length > 0) process.exitCode = 1;
  await closeDatabase();
}

main().catch(async (error: unknown) => {
  console.error(`wallet provisioning failed: ${messageOf(error)}`);
  process.exitCode = 1;
  await closeDatabase().catch(() => {});
});
