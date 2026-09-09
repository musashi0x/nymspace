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
 * before anything is sent. Assertion 3 holds recipient and wallet constant so
 * neither can explain the difference between the two outcomes. And assertion 4
 * is the only one that proves the *policy* is the binding constraint: raise the
 * limit above the denied amount, resubmit the identical request, watch it
 * execute, restore the limit, watch it be denied again. Without that the gate
 * cannot separate an enforced limit from an integration that happens to reject
 * everything.
 *
 * The denied payment runs before the allowed one, per task 5.6.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { formatEther, parseEther } from "viem";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { requireServerEnv } from "@nymspace/core/env";
import type { Address } from "@nymspace/core";
import { Store, closeDatabase, database, migrate } from "@nymspace/store";
import {
  PrivyClient,
  previewAgainstLimit,
  type PaymentRequest,
  type PaymentResult,
  type PolicyLimit,
} from "../src/index";

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_PATH = resolve(HERE, "..", "evidence", "gate-c.json");

const AGENT_DB_ID = "agent-research";
const CAIP2 = "eip155:84532" as const;

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
  chain: ReturnType<typeof createPublicClient>,
): Promise<PaymentResult> {
  const result = await privy.sendPayment(walletId, request);
  if (result.status === "executed") {
    await chain.waitForTransactionReceipt({
      hash: result.transactionHash as `0x${string}`,
    });
  }
  return result;
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

  const secrets = [
    env.PRIVY_APP_SECRET,
    env.PRIVY_AUTHORIZATION_PRIVATE_KEY,
    process.env["ENSV2_ORGANIZATION_PRIVATE_KEY"] ?? "",
    process.env["ENSV2_AGENT_CONTROLLER_PRIVATE_KEY"] ?? "",
    process.env["GRAPH_API_KEY"] ?? "",
    process.env["GEMINI_API_KEY"] ?? "",
  ].filter(Boolean);

  const allowedWei = BigInt(env.DEMO_ALLOWED_PAYMENT_AMOUNT);
  const deniedWei = BigInt(env.DEMO_DENIED_PAYMENT_AMOUNT);
  const recipient = env.DEMO_PAYMENT_RECIPIENT as Address;

  const privy = new PrivyClient();
  const db = database();
  await migrate(db);
  const store = new Store(db);

  const ref = await store.getFinancialAuthority(AGENT_DB_ID);
  if (!ref?.policyId) {
    throw new Error(
      `No wallet for ${AGENT_DB_ID}. Run \`pnpm provision:wallet\` first.`,
    );
  }

  console.log(`Gate C — Financial\n  wallet ${ref.walletAddress}\n`);
  Object.assign(facts, {
    agentId: AGENT_DB_ID,
    walletId: ref.privyWalletId,
    walletAddress: ref.walletAddress,
    policyId: ref.policyId,
    allowedWei: allowedWei.toString(),
    deniedWei: deniedWei.toString(),
    recipient,
    caip2: CAIP2,
  });

  const chain = createPublicClient({
    chain: baseSepolia,
    transport: http(process.env["BASE_SEPOLIA_RPC_URL"] ?? "https://sepolia.base.org"),
  });

  ////////////////////////////////////////////////////////////////////////////
  // 1 — the wallet loads, and holds more than the denied amount
  ////////////////////////////////////////////////////////////////////////////

  /**
   * The control that removes the boring explanation, and it has to cover the
   * whole run rather than one payment.
   *
   * Assertion 4 spends the denied amount for real — it raises the limit and the
   * identical request then executes — and the restore step must still be
   * denied by the policy rather than by funds. So the floor is two denied
   * amounts plus the allowed one. Checking only "more than the denied amount"
   * passed here and then failed at assertion 4 with "insufficient funds", which
   * is precisely the mis-attributed denial this gate exists to prevent.
   */
  const wallet = await privy.getWallet(ref.privyWalletId);
  const balance = await chain.getBalance({ address: ref.walletAddress as Address });
  const runFloor = deniedWei * 2n + allowedWei;

  assert(
    1,
    "the wallet loads by agent id and holds enough for the whole run",
    wallet.address.toLowerCase() === ref.walletAddress.toLowerCase() &&
      balance >= runFloor,
    balance >= runFloor
      ? `${formatEther(balance)} ETH against a run floor of ${formatEther(runFloor)} ETH`
      : `${formatEther(balance)} ETH is below the ${formatEther(runFloor)} ETH a run needs — run \`pnpm provision:wallet\` to top up`,
  );
  facts["walletBalanceWei"] = balance.toString();
  facts["walletPolicyIds"] = wallet.policyIds;

  ////////////////////////////////////////////////////////////////////////////
  // 5 — the displayed limit comes from the live policy
  ////////////////////////////////////////////////////////////////////////////

  const limit = await privy.getPolicyLimit(ref.policyId);
  facts["limitBefore"] = limit;

  const orderCorrect =
    allowedWei <= BigInt(limit.maxValueWei) && deniedWei > BigInt(limit.maxValueWei);
  assert(
    5,
    "the displayed limit is read from the policy and brackets both amounts",
    orderCorrect,
    `allowed ${formatEther(allowedWei)} <= limit ${formatEther(BigInt(limit.maxValueWei))} < denied ${formatEther(deniedWei)} ETH`,
  );

  ////////////////////////////////////////////////////////////////////////////
  // 2 — the denied payment, run first
  ////////////////////////////////////////////////////////////////////////////

  const deniedRequest: PaymentRequest = {
    amount: deniedWei.toString(),
    recipient,
    caip2: CAIP2,
    memo: "Gate C over-limit payment",
  };

  const denied = await sendAndSettle(privy, ref.privyWalletId, deniedRequest, chain);
  facts["deniedRequest"] = deniedRequest;
  facts["deniedResult"] = denied;

  assert(
    2,
    "the over-limit payment returns denied with a policy reason and broadcasts nothing",
    denied.status === "denied" && !("transactionHash" in denied),
    denied.status === "denied"
      ? denied.reason
      : `returned ${denied.status} instead of denied`,
  );

  await store.recordEvent({
    organizationId: "nymspace",
    agentId: AGENT_DB_ID,
    source: "privy",
    type: "privy.payment.denied",
    status: denied.status === "denied" ? "denied" : "failed",
    occurredAt: new Date().toISOString(),
    summary: `Over-limit payment of ${formatEther(deniedWei)} ETH was ${denied.status}`,
    evidence: {
      source: "privy",
      requestId: ("requestId" in denied && denied.requestId) || ref.privyWalletId,
      policyDecision: denied.status,
    },
    metadata: { requestedWei: deniedWei.toString(), limitWei: limit.maxValueWei },
  });

  ////////////////////////////////////////////////////////////////////////////
  // 3 — the allowed payment, same wallet, same recipient, same run
  ////////////////////////////////////////////////////////////////////////////

  const allowedRequest: PaymentRequest = {
    amount: allowedWei.toString(),
    recipient,
    caip2: CAIP2,
    memo: "Gate C under-limit payment",
  };

  const allowed = await sendAndSettle(privy, ref.privyWalletId, allowedRequest, chain);
  facts["allowedRequest"] = allowedRequest;
  facts["allowedResult"] = allowed;

  assert(
    3,
    "the under-limit payment executes, holding wallet and recipient constant",
    allowed.status === "executed",
    allowed.status === "executed"
      ? allowed.transactionHash
      : `returned ${allowed.status}: ${"reason" in allowed ? allowed.reason : ""}`,
  );

  if (allowed.status === "executed") {
    await store.recordEvent({
      organizationId: "nymspace",
      agentId: AGENT_DB_ID,
      source: "privy",
      type: "privy.payment.executed",
      status: "success",
      occurredAt: new Date().toISOString(),
      txHash: allowed.transactionHash as `0x${string}`,
      summary: `Under-limit payment of ${formatEther(allowedWei)} ETH executed`,
      evidence: { source: "privy", txHash: allowed.transactionHash as `0x${string}` },
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
  const raisedTo = deniedWei + parseEther("0.001");
  const raised = await privy.updateAmountPolicy(ref.policyId, raisedTo);
  facts["limitRaised"] = raised;

  const limitMoved = BigInt(raised.maxValueWei) === raisedTo;
  const afterRaise = await sendAndSettle(privy, ref.privyWalletId, deniedRequest, chain);
  facts["afterRaiseResult"] = afterRaise;

  const restored = await privy.updateAmountPolicy(
    ref.policyId,
    BigInt(limit.maxValueWei),
  );
  facts["limitRestored"] = restored;

  const afterRestore = await sendAndSettle(privy, ref.privyWalletId, deniedRequest, chain);
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
    limitMoved && BigInt(restored.maxValueWei) === BigInt(limit.maxValueWei),
    `${formatEther(BigInt(limit.maxValueWei))} → ${formatEther(BigInt(raised.maxValueWei))} → ${formatEther(BigInt(restored.maxValueWei))} ETH`,
  );

  ////////////////////////////////////////////////////////////////////////////
  // 7 — task 5.12: tampering with the preview changes nothing
  ////////////////////////////////////////////////////////////////////////////

  /**
   * The preview is what a browser could lie about. This asserts the preview and
   * the provider disagree when the displayed limit is forged, and that the
   * provider is the one that decides.
   */
  const forged: PolicyLimit = { ...restored, maxValueWei: (deniedWei * 10n).toString() };
  const forgedPreview = previewAgainstLimit(deniedRequest, forged);
  const tampered = await sendAndSettle(privy, ref.privyWalletId, deniedRequest, chain);
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
  // 10 — task 5.10: the agent cannot alter the policy that binds it
  ////////////////////////////////////////////////////////////////////////////

  /**
   * Asked as a real request, not asserted as a design claim.
   *
   * The agent's entire capability is the wallet's RPC endpoint, so this sends a
   * policy mutation through that endpoint and requires it to be refused. The
   * structural argument — the wallet holds no API credential, and the policy is
   * owned by the application rather than by the wallet's key quorum — is the
   * reason it should fail; this is the check that the reason holds in practice.
   *
   * A denial here is not the amount policy working. It is the coarser fact that
   * a signing path is not an administration path, which is what separates "the
   * agent spends within a limit" from "the agent could raise its own limit".
   */
  let agentAlteredPolicy = false;
  let alterDetail: string;
  try {
    const response = await fetch(
      `https://api.privy.io/v1/wallets/${ref.privyWalletId}/rpc`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          method: "privy_updatePolicy",
          params: { policy_id: ref.policyId, max_value: "0xffffffffffffffff" },
        }),
      },
    );
    agentAlteredPolicy = response.ok;
    alterDetail = `unauthenticated policy mutation returned ${response.status}`;
  } catch (error) {
    alterDetail = `unauthenticated policy mutation failed: ${messageOf(error)}`;
  }

  // And the limit is unchanged afterwards, which is the assertion that matters:
  // a rejected request that somehow moved the limit would be worse than an
  // accepted one, because nothing would have reported it.
  const limitAfterAttempt = await privy.getPolicyLimit(ref.policyId);

  assert(
    10,
    "the agent's signing path cannot alter the policy that binds it",
    !agentAlteredPolicy &&
      limitAfterAttempt.maxValueWei === limit.maxValueWei,
    `${alterDetail}; limit still ${formatEther(BigInt(limitAfterAttempt.maxValueWei))} ETH`,
  );
  facts["limitAfterAlterAttempt"] = limitAfterAttempt;

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
