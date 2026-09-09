/**
 * Simulate a prepared organization transaction without signing it.
 *
 * `POST /v1/agents/:id/permissions/prepare` returns calldata that nothing has
 * yet executed. Until a wallet broadcasts it, the only claim we can make is
 * "the API produced 260 bytes" — which is not a claim about correctness. Bad
 * calldata is 260 bytes too.
 *
 * `eth_call` costs nothing and needs no key. It answers the two questions that
 * actually matter before a human is asked to sign:
 *
 *   1. Would this transaction succeed from the organization?
 *   2. Is the authority gate enforced on chain, or only in the UI?
 *
 * (2) is the falsifiable one. If the same calldata succeeds from an account
 * that is not the organization, then the permission model is decoration and the
 * product's central claim is false. So this asserts the revert, not just the
 * success — a test that can only pass is not evidence.
 *
 * Run: pnpm --filter @nymspace/ens verify:prepared
 * Requires the API running on API_PORT (default 3112) and an RPC URL.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeErrorResult, type Address, type Hex } from "viem";
import { permissionedResolverAbi } from "../src/abis.js";

const RPC_URL = process.env.SEPOLIA_RPC_URL;
const ORGANIZATION = process.env.ENSV2_ORGANIZATION_ADDRESS as Address | undefined;
const CONTROLLER = process.env.ENSV2_AGENT_CONTROLLER_ADDRESS as Address | undefined;
const API = `http://localhost:${process.env.API_PORT ?? 3112}`;
const AGENT = process.argv[2] ?? "research";
const RECORD_KEY = process.argv[3] ?? "agent-context";

/**
 * A funded-looking address that is definitely not the organization. Used only
 * as an `eth_call` sender, so it never needs to exist or hold anything.
 */
const OUTSIDER = "0x00000000000000000000000000000000DeaDBeef" as Address;

async function rpc<T>(method: string, params: unknown[]): Promise<
  { ok: true; result: T } | { ok: false; message: string; data?: Hex }
> {
  const res = await fetch(RPC_URL!, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as {
    result?: T;
    error?: { message: string; data?: Hex };
  };
  if (body.error) {
    return { ok: false, message: body.error.message, data: body.error.data };
  }
  return { ok: true, result: body.result as T };
}

/** Name the revert if it is one of ours; otherwise say so rather than guess. */
function describeRevert(data: Hex | undefined): string {
  if (!data || data === "0x") return "reverted with no data";
  try {
    const decoded = decodeErrorResult({ abi: permissionedResolverAbi, data });
    return `${decoded.errorName}(${(decoded.args ?? []).map(String).join(", ")})`;
  } catch {
    return `reverted with an error not in our ABI (${data.slice(0, 10)})`;
  }
}

async function main() {
  if (!RPC_URL || !ORGANIZATION || !CONTROLLER) {
    throw new Error(
      "Set SEPOLIA_RPC_URL, ENSV2_ORGANIZATION_ADDRESS and ENSV2_AGENT_CONTROLLER_ADDRESS.",
    );
  }

  const prepareRes = await fetch(
    `${API}/v1/agents/${AGENT}/permissions/prepare`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        controller: CONTROLLER,
        recordKey: RECORD_KEY,
        grant: true,
      }),
    },
  );
  if (!prepareRes.ok) {
    throw new Error(
      `prepare failed (${prepareRes.status}). Is the API running on ${API}?`,
    );
  }
  const prepared = (await prepareRes.json()) as {
    transaction: { to: Address; data: Hex; chainId: number };
    expectedSigner: Address;
  };

  const { to, data } = prepared.transaction;

  // The transaction the organization would actually sign.
  const asOrganization = await rpc<Hex>("eth_call", [
    { from: ORGANIZATION, to, data },
    "latest",
  ]);

  // The same bytes from someone else. This one is *supposed* to fail.
  const asOutsider = await rpc<Hex>("eth_call", [
    { from: OUTSIDER, to, data },
    "latest",
  ]);

  const gas = await rpc<Hex>("eth_estimateGas", [
    { from: ORGANIZATION, to, data },
  ]);
  const balance = await rpc<Hex>("eth_getBalance", [ORGANIZATION, "latest"]);

  const gateHolds = asOrganization.ok && !asOutsider.ok;

  const evidence = {
    ranAt: new Date().toISOString(),
    check: "prepared-organization-transaction",
    go: gateHolds,
    facts: {
      agent: AGENT,
      recordKey: RECORD_KEY,
      resolver: to,
      chainId: prepared.transaction.chainId,
      expectedSigner: prepared.expectedSigner,
      calldataBytes: (data.length - 2) / 2,
      selector: data.slice(0, 10),
    },
    simulation: {
      fromOrganization: asOrganization.ok
        ? { outcome: "would succeed" as const }
        : {
            outcome: "would revert" as const,
            detail: describeRevert(asOrganization.data),
          },
      fromOutsider: asOutsider.ok
        ? { outcome: "would succeed" as const }
        : {
            outcome: "would revert" as const,
            detail: describeRevert(asOutsider.data),
          },
      gasEstimate: gas.ok ? Number.parseInt(gas.result, 16) : null,
      organizationBalanceWei: balance.ok
        ? BigInt(balance.result).toString()
        : null,
    },
    /**
     * What this does NOT establish: that a wallet-signed transaction lands on
     * chain. `eth_call` proves the calldata is right and the gate is real; it
     * does not exercise MetaMask, the confirm route, or the receipt path.
     */
    doesNotEstablish: "that a wallet-signed transaction lands on chain",
  };

  const out = join(import.meta.dirname, "..", "evidence", "prepared-tx.json");
  writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`);

  console.log(`from the organization       ${evidence.simulation.fromOrganization.outcome}`);
  console.log(
    `from an outsider            ${evidence.simulation.fromOutsider.outcome}` +
      ("detail" in evidence.simulation.fromOutsider
        ? ` — ${evidence.simulation.fromOutsider.detail}`
        : ""),
  );
  console.log(`gas estimate                ${evidence.simulation.gasEstimate}`);
  console.log(`\nwrote ${out}`);

  if (!gateHolds) {
    console.error(
      "\nFAIL: the authority gate did not behave as claimed. Either the " +
        "organization cannot sign this, or an outsider can — both are " +
        "product-breaking, not test noise.",
    );
    process.exitCode = 1;
  }
}

await main();
