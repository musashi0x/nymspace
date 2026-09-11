/**
 * Gate C — Financial.
 *
 * Run: pnpm --filter @nymspace/privy verify:policy
 * Emits: packages/privy/evidence/gate-c.json
 *
 * The gate lies by producing a denial whose cause is not the policy. An
 * underfunded wallet, a bad recipient, a malformed amount and an expired
 * credential all reject and all normalise to `denied`. The mirror failure is
 * worse and quieter: a policy that denies nothing demos as a clean success, and
 * nobody looks at a green run.
 *
 * So the controls are structural. Assertion 1 removes the funding explanation
 * before anything is sent. Assertion 3 holds recipient, token and wallet
 * constant so none of them can explain the difference between the two outcomes.
 * And assertion 4 is the only one that proves the *policy* is the binding
 * constraint: raise the limit above the denied amount, resubmit the identical
 * request, watch it execute, restore the limit, watch it be denied again.
 * Without that the gate cannot separate an enforced limit from an integration
 * that happens to reject everything.
 *
 * Assertions 11 and 12 are about *whose* limit it is. They only run when the
 * wallet's authority has been split by `pnpm provision:signers`; with a
 * wallet-level policy there is one authority and nothing to compare it to, and
 * the gate says so rather than skipping silently.
 *
 * The denied payment runs before the allowed one, per task 5.6.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { requireServerEnv } from "@nymspace/core/env";
import type { Address } from "@nymspace/core";
import { Store, closeDatabase, database, migrate } from "@nymspace/store";
import {
  PrivyClient,
  agentSignerKey,
  demoToken,
  formatAmount,
  ownerSignerKey,
  previewAgainstLimit,
  toBaseUnits,
  type PaymentRequest,
  type PaymentResult,
  type PolicyLimit,
  type TokenSpec,
} from "../src/index";

/**
 * `ReturnType<typeof createPublicClient>` resolves the generics to their
 * defaults — chain `undefined` — so its `getBlock` returns the four base
 * transaction types. baseSepolia is an OP-Stack chain whose formatters add a
 * fifth (`deposit`), and the real client is therefore not assignable to it.
 * Deriving the type from the same call that builds the client keeps the chain
 * parameter attached.
 */
function createChainClient() {
  return createPublicClient({
    chain: baseSepolia,
    transport: http(
      process.env["BASE_SEPOLIA_RPC_URL"] ?? "https://sepolia.base.org",
    ),
  });
}

type ChainClient = ReturnType<typeof createChainClient>;

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_PATH = resolve(HERE, "..", "evidence", "gate-c.json");

const AGENT_DB_ID = "agent-research";
const CAIP2 = "eip155:84532" as const;

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

interface Assertion {
  n: number;
  name: string;
  passed: boolean;
  detail: string;
}

const assertions: Assertion[] = [];
const facts: Record<string, unknown> = {};

function assert(n: number, name: string, passed: boolean, detail: string): void {
  assertions.push({ n, name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${n}. ${name} — ${detail}`);
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split("\n")[0] ?? text;
}

/**
 * Send, and wait for the chain to catch up before the next send.
 *
 * Privy assigns the nonce from its own view of the account, so two payments
 * issued back to back race each other and the second fails with "nonce too
 * low". That normalises to `failed` and reads as a broken integration — another
 * denial with the wrong cause, which is the exact class of confusion this gate
 * exists to eliminate. So an executed payment is confirmed before the next one
 * is issued.
 */
async function sendAndSettle(
  privy: PrivyClient,
  walletId: string,
  request: PaymentRequest,
  chain: ChainClient,
): Promise<PaymentResult> {
  const result = await privy.sendPayment(walletId, request);
  if (result.status === "executed") {
    await chain.waitForTransactionReceipt({
      hash: result.transactionHash as `0x${string}`,
    });
  }
  return result;
}

/** What the wallet holds of whatever the demo pays in. */
async function heldBalance(
  chain: ChainClient,
  wallet: Address,
  token: TokenSpec | null,
): Promise<bigint> {
  if (!token) return chain.getBalance({ address: wallet });
  return (await chain.readContract({
    address: token.address,
    abi: BALANCE_OF,
    functionName: "balanceOf",
    args: [wallet],
  })) as bigint;
}

/**
 * Task 5.11 — nothing that leaves this process may carry a credential.
 *
 * Scans a serialised payload for the actual secret values rather than for
 * field names, because a leak that renamed the field would pass a name check
 * and is exactly as bad.
 */
function containsCredential(payload: unknown, secrets: string[]): string[] {
  const text = JSON.stringify(payload) ?? "";
  return secrets.filter((secret) => secret.length > 8 && text.includes(secret));
}

//////////////////////////////////////////////////////////////////////////////

async function main(): Promise<void> {
  const env = requireServerEnv([
    "PRIVY_APP_SECRET",
    "PRIVY_AUTHORIZATION_PRIVATE_KEY",
    "DEMO_ALLOWED_PAYMENT_AMOUNT",
    "DEMO_DENIED_PAYMENT_AMOUNT",
    "DEMO_PAYMENT_RECIPIENT",
  ] as const);

  const ownerKey = ownerSignerKey();

  const secrets = [
    env.PRIVY_APP_SECRET,
    env.PRIVY_AUTHORIZATION_PRIVATE_KEY,
    ownerKey?.privateKey ?? "",
    process.env["ENSV2_ORGANIZATION_PRIVATE_KEY"] ?? "",
    process.env["ENSV2_AGENT_CONTROLLER_PRIVATE_KEY"] ?? "",
    process.env["GRAPH_API_KEY"] ?? "",
    process.env["GEMINI_API_KEY"] ?? "",
  ].filter(Boolean);

  const token = demoToken();
  const allowed = BigInt(env.DEMO_ALLOWED_PAYMENT_AMOUNT);
  const denied = BigInt(env.DEMO_DENIED_PAYMENT_AMOUNT);
  const recipient = env.DEMO_PAYMENT_RECIPIENT as Address;

  /** The agent's client. Its key is the one the policy caps. */
  const privy = new PrivyClient({ authorizationKey: agentSignerKey() });
  /** The organization's. Absent means no escalation exists to test. */
  const owner = ownerKey ? privy.withKey(ownerKey) : undefined;

  const db = database();
  await migrate(db);
  const store = new Store(db);

  const ref = await store.getFinancialAuthority(AGENT_DB_ID);
  if (!ref?.policyId) {
    throw new Error(
      `No wallet for ${AGENT_DB_ID}. Run \`pnpm provision:wallet\` first.`,
    );
  }

  console.log(
    `Gate C — Financial\n  wallet ${ref.walletAddress}\n  paying in ${token?.symbol ?? "native ETH"}\n`,
  );
  Object.assign(facts, {
    agentId: AGENT_DB_ID,
    walletId: ref.privyWalletId,
    walletAddress: ref.walletAddress,
    policyId: ref.policyId,
    token: token ?? "native",
    allowed: allowed.toString(),
    denied: denied.toString(),
    recipient,
    caip2: CAIP2,
  });

  const chain = createChainClient();

  ////////////////////////////////////////////////////////////////////////////
  // 1 — the wallet loads, and holds more than the whole run spends
  ////////////////////////////////////////////////////////////////////////////

  /**
   * The control that removes the boring explanation, and it has to cover the
   * whole run rather than one payment.
   *
   * Assertion 4 spends the denied amount for real — it raises the limit and the
   * identical request then executes — and the restore step must still be denied
   * by the policy rather than by funds. So the floor is two denied amounts plus
   * the allowed one. Checking only "more than the denied amount" passed here
   * and then failed at assertion 4 with "insufficient funds", which is
   * precisely the mis-attributed denial this gate exists to prevent.
   */
  const wallet = await privy.getWallet(ref.privyWalletId);
  const balance = await heldBalance(chain, ref.walletAddress as Address, token);
  const runFloor = denied * 2n + allowed;

  assert(
    1,
    "the wallet loads by agent id and holds enough for the whole run",
    wallet.address.toLowerCase() === ref.walletAddress.toLowerCase() &&
      balance >= runFloor,
    balance >= runFloor
      ? `${formatAmount(balance, token)} against a run floor of ${formatAmount(runFloor, token)}`
      : `${formatAmount(balance, token)} is below the ${formatAmount(runFloor, token)} a run needs — ` +
        (token
          ? `send ${token.symbol} on Base Sepolia to ${ref.walletAddress} (faucet.circle.com)`
          : "run `pnpm provision:wallet` to top up"),
  );
  facts["walletBalance"] = balance.toString();
  facts["walletPolicyIds"] = wallet.policyIds;
  facts["walletOwnerId"] = wallet.ownerId ?? null;
  facts["walletSigners"] = wallet.additionalSigners;

  ////////////////////////////////////////////////////////////////////////////
  // 5 — the displayed limit comes from the live policy
  ////////////////////////////////////////////////////////////////////////////

  const limit = await privy.getPolicyLimit(ref.policyId);
  facts["limitBefore"] = limit;

  const sameToken =
    (limit.token?.address.toLowerCase() ?? null) ===
    (token?.address.toLowerCase() ?? null);

  assert(
    5,
    "the displayed limit is read from the policy, in the token being paid, and brackets both amounts",
    sameToken &&
      allowed <= BigInt(limit.maxAmount) &&
      denied > BigInt(limit.maxAmount),
    sameToken
      ? `allowed ${formatAmount(allowed, token)} <= limit ${formatAmount(limit.maxAmount, limit.token)} < denied ${formatAmount(denied, token)}`
      : `the policy constrains ${limit.token?.symbol ?? "native ETH"} but the demo pays in ${token?.symbol ?? "native ETH"}`,
  );

  ////////////////////////////////////////////////////////////////////////////
  // 2 — the denied payment, run first
  ////////////////////////////////////////////////////////////////////////////

  const deniedRequest: PaymentRequest = {
    amount: denied.toString(),
    recipient,
    caip2: CAIP2,
    ...(token && { token }),
    memo: "Gate C over-limit payment",
  };

  const deniedResult = await sendAndSettle(
    privy,
    ref.privyWalletId,
    deniedRequest,
    chain,
  );
  facts["deniedRequest"] = deniedRequest;
  facts["deniedResult"] = deniedResult;

  assert(
    2,
    "the over-limit payment returns denied with a policy reason and broadcasts nothing",
    deniedResult.status === "denied" && !("transactionHash" in deniedResult),
    deniedResult.status === "denied"
      ? deniedResult.reason
      : `returned ${deniedResult.status} instead of denied`,
  );

  await store.recordEvent({
    organizationId: "nymspace",
    agentId: AGENT_DB_ID,
    source: "privy",
    type: "privy.payment.denied",
    status: deniedResult.status === "denied" ? "denied" : "failed",
    occurredAt: new Date().toISOString(),
    summary: `Over-limit payment of ${formatAmount(denied, token)} was ${deniedResult.status}`,
    evidence: {
      source: "privy",
      requestId:
        ("requestId" in deniedResult && deniedResult.requestId) ||
        ref.privyWalletId,
      policyDecision: deniedResult.status,
    },
    metadata: {
      amount: denied.toString(),
      recipient,
      tokenAddress: token?.address ?? null,
      limit: limit.maxAmount,
    },
  });

  ////////////////////////////////////////////////////////////////////////////
  // 3 — the allowed payment, same wallet, same recipient, same token
  ////////////////////////////////////////////////////////////////////////////

  const allowedRequest: PaymentRequest = {
    amount: allowed.toString(),
    recipient,
    caip2: CAIP2,
    ...(token && { token }),
    memo: "Gate C under-limit payment",
  };

  const allowedResult = await sendAndSettle(
    privy,
    ref.privyWalletId,
    allowedRequest,
    chain,
  );
  facts["allowedRequest"] = allowedRequest;
  facts["allowedResult"] = allowedResult;

  assert(
    3,
    "the under-limit payment executes, holding wallet, recipient and token constant",
    allowedResult.status === "executed",
    allowedResult.status === "executed"
      ? allowedResult.transactionHash
      : `returned ${allowedResult.status}: ${"reason" in allowedResult ? allowedResult.reason : ""}`,
  );

  if (allowedResult.status === "executed") {
    await store.recordEvent({
      organizationId: "nymspace",
      agentId: AGENT_DB_ID,
      source: "privy",
      type: "privy.payment.executed",
      status: "success",
      occurredAt: new Date().toISOString(),
      txHash: allowedResult.transactionHash as `0x${string}`,
      summary: `Under-limit payment of ${formatAmount(allowed, token)} executed`,
      evidence: {
        source: "privy",
        txHash: allowedResult.transactionHash as `0x${string}`,
      },
    });
    await store.setProvisioning(AGENT_DB_ID, { financial: "financially_active" });
  }

  ////////////////////////////////////////////////////////////////////////////
  // 4 — the policy is the binding constraint
  ////////////////////////////////////////////////////////////////////////////

  /**
   * The assertion the whole gate turns on. Everything above is consistent with
   * an integration that rejects large numbers for its own reasons; only moving
   * the policy and watching the identical request change outcome shows that the
   * policy is what decided.
   */
  const raisedTo = denied + toBaseUnits("1", token);
  const raised = await privy.updatePolicyLimit(ref.policyId, raisedTo);
  facts["limitRaised"] = raised;

  const limitMoved = BigInt(raised.maxAmount) === raisedTo;
  const afterRaise = await sendAndSettle(
    privy,
    ref.privyWalletId,
    deniedRequest,
    chain,
  );
  facts["afterRaiseResult"] = afterRaise;

  const restored = await privy.updatePolicyLimit(
    ref.policyId,
    BigInt(limit.maxAmount),
  );
  facts["limitRestored"] = restored;

  const afterRestore = await sendAndSettle(
    privy,
    ref.privyWalletId,
    deniedRequest,
    chain,
  );
  facts["afterRestoreResult"] = afterRestore;

  assert(
    4,
    "raising the limit executes the identical request, and restoring it denies again",
    afterRaise.status === "executed" && afterRestore.status === "denied",
    `raised → ${afterRaise.status}, restored → ${afterRestore.status}`,
  );

  assert(
    6,
    "changing the policy changes the value the interface would display",
    limitMoved && BigInt(restored.maxAmount) === BigInt(limit.maxAmount),
    `${formatAmount(limit.maxAmount, limit.token)} → ${formatAmount(raised.maxAmount, raised.token)} → ${formatAmount(restored.maxAmount, restored.token)}`,
  );

  ////////////////////////////////////////////////////////////////////////////
  // 7 — task 5.12: tampering with the preview changes nothing
  ////////////////////////////////////////////////////////////////////////////

  /**
   * The preview is what a browser could lie about. This asserts the preview and
   * the provider disagree when the displayed limit is forged, and that the
   * provider is the one that decides.
   */
  const forged: PolicyLimit = {
    ...restored,
    maxAmount: (denied * 10n).toString(),
  };
  const forgedPreview = previewAgainstLimit(deniedRequest, forged);
  const tampered = await sendAndSettle(
    privy,
    ref.privyWalletId,
    deniedRequest,
    chain,
  );
  facts["tamperedResult"] = tampered;

  assert(
    7,
    "a tampered client-side limit does not change the provider's decision",
    forgedPreview.withinLimit && tampered.status === "denied",
    `client preview said within-limit, Privy returned ${tampered.status}`,
  );

  ////////////////////////////////////////////////////////////////////////////
  // 8 — task 5.11: no credential in anything that leaves the process
  ////////////////////////////////////////////////////////////////////////////

  const leaked = containsCredential(
    { facts, assertions, wallet, limit, raised, restored },
    secrets,
  );
  assert(
    8,
    "no response body or evidence artifact contains a credential",
    leaked.length === 0,
    leaked.length === 0
      ? `${secrets.length} secrets checked against the full evidence payload`
      : `${leaked.length} secret value(s) appear in the payload`,
  );

  ////////////////////////////////////////////////////////////////////////////
  // 9 — task 5.13: the wallet mapping survives a restart
  ////////////////////////////////////////////////////////////////////////////

  /**
   * Read through a second store over the same database rather than the object
   * this run has been holding. The demo reconnects an agent to its wallet by
   * identifier alone, and this is the assertion that the identifier is enough.
   */
  const reloaded = await new Store(db).getFinancialAuthority(AGENT_DB_ID);
  assert(
    9,
    "the wallet mapping reloads from the store by agent id alone",
    reloaded?.privyWalletId === ref.privyWalletId &&
      reloaded?.walletAddress === ref.walletAddress,
    `${reloaded?.privyWalletId} at ${reloaded?.walletAddress}`,
  );

  ////////////////////////////////////////////////////////////////////////////
  // 10 — task 5.10: an anonymous caller has no authority at all
  ////////////////////////////////////////////////////////////////////////////

  let anonymousSucceeded = false;
  let anonymousDetail: string;
  try {
    const response = await fetch(
      `https://api.privy.io/v1/wallets/${ref.privyWalletId}/rpc`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          method: "eth_sendTransaction",
          caip2: CAIP2,
          params: { transaction: { to: recipient, value: "0x1" } },
        }),
      },
    );
    anonymousSucceeded = response.ok;
    anonymousDetail = `unauthenticated wallet request returned ${response.status}`;
  } catch (error) {
    anonymousDetail = `unauthenticated wallet request failed: ${messageOf(error)}`;
  }

  assert(
    10,
    "an unsigned, unauthenticated request carries no authority",
    !anonymousSucceeded,
    anonymousDetail,
  );

  ////////////////////////////////////////////////////////////////////////////
  // 11 — the agent cannot reconfigure the authority that binds it
  ////////////////////////////////////////////////////////////////////////////

  /**
   * Asked as a real request signed by the agent's own key, not asserted as a
   * design claim.
   *
   * The previous version of this check sent an *unauthenticated* request, which
   * only showed that anonymous callers are refused — true of every endpoint,
   * and no evidence about the agent at all. This signs the mutation with the
   * key the agent actually holds and requires Privy to refuse it, because
   * changing a signer is a wallet update and wallet updates need the owner.
   *
   * A denial here is not the amount policy working. It is the coarser fact that
   * a signing path is not an administration path, which is what separates "the
   * agent spends within a limit" from "the agent could raise its own limit".
   */
  const split = wallet.ownerId !== undefined && wallet.additionalSigners.length > 0;

  if (!split) {
    assert(
      11,
      "the agent's own key cannot reconfigure its signer",
      false,
      "the wallet has no owner and no additional signers, so the cap is on the wallet rather than " +
        "on the agent — run `pnpm provision:signers`, or accept the weaker claim knowingly",
    );
  } else {
    let agentReconfigured = false;
    let reconfigureDetail: string;
    try {
      await privy.setWalletSigners(ref.privyWalletId, {
        additionalSigners: [
          { signerId: wallet.additionalSigners[0]!.signerId, overridePolicyIds: [] },
        ],
      });
      agentReconfigured = true;
      reconfigureDetail =
        "Privy ACCEPTED a signer change signed by the agent's key — the wallet's " +
        "signer configuration has been overwritten; re-run `pnpm provision:signers`";
    } catch (error) {
      reconfigureDetail = `refused: ${messageOf(error)}`;
    }

    // And the configuration is unchanged afterwards, which is the assertion that
    // matters: a rejected request that somehow took effect would be worse than
    // an accepted one, because nothing would have reported it.
    const after = await privy.getWallet(ref.privyWalletId);
    const unchanged =
      JSON.stringify(after.additionalSigners) ===
      JSON.stringify(wallet.additionalSigners);

    assert(
      11,
      "the agent's own key cannot reconfigure its signer",
      !agentReconfigured && unchanged,
      `${reconfigureDetail}; signer configuration ${unchanged ? "unchanged" : "CHANGED"}`,
    );
    facts["signersAfterAgentAttempt"] = after.additionalSigners;
  }

  ////////////////////////////////////////////////////////////////////////////
  // 12 — the owner executes what the agent was denied
  ////////////////////////////////////////////////////////////////////////////

  /**
   * The assertion that makes the approval affordance honest.
   *
   * Same wallet, same recipient, same token, same amount — the only thing that
   * changes is which key signs. If this executes, the escalation the console
   * offers is a real difference in authority; if it does not, the console must
   * offer nothing, and `PRIVY_OWNER_*` should be unset rather than the button
   * left on screen.
   */
  if (!owner) {
    assert(
      12,
      "a higher authority executes the request the agent was denied",
      true,
      "no owner key is configured, so no approval path is offered and none is claimed",
    );
  } else {
    const escalated = await sendAndSettle(
      owner,
      ref.privyWalletId,
      deniedRequest,
      chain,
    );
    facts["escalatedResult"] = escalated;

    assert(
      12,
      "a higher authority executes the request the agent was denied",
      escalated.status === "executed",
      escalated.status === "executed"
        ? `owner key executed ${formatAmount(denied, token)}: ${escalated.transactionHash}`
        : `owner key returned ${escalated.status}: ${"reason" in escalated ? escalated.reason : ""}`,
    );
  }

  ////////////////////////////////////////////////////////////////////////////

  const failures = assertions.filter((a) => !a.passed);
  const go = failures.length === 0;

  mkdirSync(dirname(EVIDENCE_PATH), { recursive: true });
  writeFileSync(
    EVIDENCE_PATH,
    `${JSON.stringify({ ranAt: new Date().toISOString(), gate: "C", go, facts, assertions }, null, 2)}\n`,
  );

  console.log(`\n${assertions.length - failures.length}/${assertions.length} assertions passed`);
  console.log(`evidence: ${EVIDENCE_PATH}`);
  console.log(go ? "\nGate C: PASS" : "\nGate C: FAIL");
  if (!go) process.exitCode = 1;

  await closeDatabase();
}

main().catch(async (error: unknown) => {
  console.error(`Gate C could not run: ${messageOf(error)}`);
  process.exitCode = 1;
  await closeDatabase().catch(() => {});
});
