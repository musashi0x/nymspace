/**
 * Gate 0 — credentials are real.
 *
 * `pnpm env:check` proves a variable is declared. It cannot prove the value
 * works, and that gap is the failure this script exists to close:
 * `GRAPH_API_KEY=changeme` satisfies every declaration check in the repository
 * and then fails four hours later inside Gate B, where it reads as a subgraph
 * schema problem rather than as a credential problem.
 *
 * So there are no length checks and no truthiness checks here. Every assertion
 * below is a real authenticated round trip to the provider, reported with the
 * provider's own response code, and every check that can go through the
 * product's own code path does — a gate that proves a credential works against
 * a URL the product does not use has proved the wrong thing.
 *
 * Run: pnpm check:credentials
 *
 * Exit code is the gate. A section blocked on a failing provider does not
 * start; chasing that credential is the only work on its path.
 */

import { formatEther } from "viem";
import { Agent0Client } from "@nymspace/graph";
import {
  chainConfig,
  createViemChainClient,
  type ViemChainClient,
} from "@nymspace/ens";
import type { Address, Hex } from "@nymspace/core";

//////////////////////////////////////////////////////////////////////////////
// Spend budget
//////////////////////////////////////////////////////////////////////////////

/**
 * What this change's onchain work costs, derived rather than guessed.
 *
 * The first version of this was a round number someone felt was generous, and
 * it failed the gate at a balance that was in fact ~500 times the work — which
 * is its own kind of gate lie: a check that blocks a section for a reason that
 * is not true. So the basis is measured instead.
 *
 * `MEASURED_COST_PER_TX_WEI` is the mean of the Day 1 spike's five recorded
 * transactions, read back from their receipts on Sepolia:
 *
 *   register subname                 170,274 gas   0.00018386 ETH
 *   authorizeTextRoles grant          90,665 gas   0.00009210 ETH
 *   controller setText               109,908 gas   0.00011027 ETH
 *   organization setText (ENSIP 25)   66,359 gas   0.00007187 ETH
 *   authorizeTextRoles revoke         42,745 gas   0.00004460 ETH
 *
 * all at roughly 1 gwei. `register` is the most expensive operation this change
 * performs, so the mean is not hiding a heavier call in the tail.
 *
 * The transaction budgets are counted from `tasks.md`: the organization signs
 * three registrations, three `agent-context` writes, an `agent-endpoint[mcp]`
 * write, an ENSIP 25 write, the record-scoped grants, an ERC 8004 registration,
 * and Gate D's revoke and re-grant — call it forty across the reruns a gate
 * runner implies. The controller signs one permitted write and several
 * deliberately reverting ones, which still burn gas up to the revert.
 *
 * The headroom multiplier is the part that matters, and it covers the one
 * variable a measurement cannot: Sepolia's base fee is ~1 gwei today and has no
 * obligation to stay there. Ten times leaves the floor two orders of magnitude
 * above the measured work while still failing on a genuinely empty key.
 */
const MEASURED_COST_PER_TX_WEI = 100_540_000_000_000n; // 0.00010054 ETH
const GAS_PRICE_HEADROOM = 10n;

const TRANSACTION_BUDGET = {
  organization: 40n,
  controller: 10n,
} as const;

const MINIMUM_BALANCE_WEI = {
  organization:
    MEASURED_COST_PER_TX_WEI * TRANSACTION_BUDGET.organization * GAS_PRICE_HEADROOM,
  controller:
    MEASURED_COST_PER_TX_WEI * TRANSACTION_BUDGET.controller * GAS_PRICE_HEADROOM,
} as const;

//////////////////////////////////////////////////////////////////////////////
// Result plumbing
//////////////////////////////////////////////////////////////////////////////

interface CheckResult {
  provider: string;
  name: string;
  passed: boolean;
  /** The provider's own response code, or the reason there is none. */
  code: string;
  detail: string;
  /** Informational checks report but never fail the gate. */
  advisory?: boolean;
}

const results: CheckResult[] = [];

function record(result: CheckResult): void {
  results.push(result);
  const mark = result.passed ? "ok  " : result.advisory ? "warn" : "FAIL";
  console.log(
    `${mark}  ${result.provider.padEnd(12)} ${result.code.padEnd(18)} ${result.name} — ${result.detail}`,
  );
}

/** Reduce anything thrown into a printable reason without losing the code. */
function reasonOf(error: unknown): string {
  if (error instanceof Error) return error.message.split("\n")[0] ?? error.name;
  return String(error);
}

//////////////////////////////////////////////////////////////////////////////
// Gate 0.4 — the two signers
//////////////////////////////////////////////////////////////////////////////

/**
 * Asserted here as well as inside `createViemChainClient`, because this is the
 * gate the failure invalidates. If both keys derive the same address every
 * allowed write in Gate A passes, every denial is a self-denial, and the whole
 * delegation proof is vacuous while rendering as a clean green run.
 */
function checkSigners(client: ViemChainClient): void {
  const same = client.organization === client.controller;
  record({
    provider: "keys",
    name: "organization and controller are different accounts",
    passed: !same,
    code: same ? "identical" : "distinct",
    detail: same
      ? `both keys derive ${client.organization}; every denial would be a self-denial`
      : `${client.organization} vs ${client.controller}`,
  });
}

async function checkBalance(
  client: ViemChainClient,
  signer: "organization" | "controller",
): Promise<void> {
  const address = client.addressOf(signer);
  try {
    const balance = await client.getBalance(address);
    const minimum = MINIMUM_BALANCE_WEI[signer];
    record({
      provider: "keys",
      name: `${signer} is funded above the run's floor`,
      passed: balance >= minimum,
      code: `${formatEther(balance)} ETH`,
      // The floor shows its derivation, so a failure can be argued with rather
      // than merely obeyed — the previous round number could not be.
      detail:
        `${address}, floor ${formatEther(minimum)} ETH ` +
        `(${TRANSACTION_BUDGET[signer]} tx × ${formatEther(MEASURED_COST_PER_TX_WEI)} measured × ${GAS_PRICE_HEADROOM} headroom)`,
    });
  } catch (error) {
    record({
      provider: "keys",
      name: `${signer} balance is readable`,
      passed: false,
      code: "rpc-error",
      detail: reasonOf(error),
    });
  }
}

//////////////////////////////////////////////////////////////////////////////
// Gate 0.3 — the contracts exist
//////////////////////////////////////////////////////////////////////////////

async function checkCode(
  client: ViemChainClient,
  label: string,
  address: Address | undefined,
  envName: string,
): Promise<void> {
  if (!address) {
    record({
      provider: "chain",
      name: `${label} is configured`,
      passed: false,
      code: "unset",
      detail: `${envName} is empty`,
    });
    return;
  }

  try {
    const code = await client.getCode(address);
    const size = code ? (code.length - 2) / 2 : 0;
    record({
      provider: "chain",
      name: `${label} has code`,
      passed: size > 0,
      code: `${size} bytes`,
      detail: address,
    });
  } catch (error) {
    record({
      provider: "chain",
      name: `${label} has code`,
      passed: false,
      code: "rpc-error",
      detail: `${address}: ${reasonOf(error)}`,
    });
  }
}

/**
 * Task 1.4's second half: the parent label still points at the registry proxy
 * the spike deployed.
 *
 * `getCode` proves a contract is there. It does not prove it is still *wired*,
 * and an unwired parent label is the failure that would surface as a confusing
 * revert inside the first `register` call of Gate A rather than here.
 */
async function checkParentWiring(client: ViemChainClient): Promise<void> {
  const config = chainConfig();
  const label = config.deployed.parentLabel;
  const expected = config.deployed.parentRegistry;

  if (!label || !expected) {
    record({
      provider: "chain",
      name: "parent label resolves to the registry proxy",
      passed: false,
      code: "unset",
      detail: "ENSV2_PARENT_LABEL or ENSV2_PARENT_REGISTRY_ADDRESS is empty",
    });
    return;
  }

  try {
    const actual = (await client.readContract({
      address: config.ensv2.ethRegistry,
      abi: [
        {
          type: "function",
          name: "getSubregistry",
          stateMutability: "view",
          inputs: [{ name: "label", type: "string" }],
          outputs: [{ name: "", type: "address" }],
        },
      ],
      functionName: "getSubregistry",
      args: [label],
    })) as Address;

    const matches = actual.toLowerCase() === expected.toLowerCase();
    record({
      provider: "chain",
      name: "parent label resolves to the registry proxy",
      passed: matches,
      code: matches ? "wired" : "mismatch",
      detail: matches
        ? `${label}.eth → ${actual}`
        : `${label}.eth → ${actual}, expected ${expected}`,
    });
  } catch (error) {
    record({
      provider: "chain",
      name: "parent label resolves to the registry proxy",
      passed: false,
      code: "rpc-error",
      detail: reasonOf(error),
    });
  }
}

//////////////////////////////////////////////////////////////////////////////
// Gate 0.1 — The Graph
//////////////////////////////////////////////////////////////////////////////

/**
 * Deliberately routed through `Agent0Client` rather than a fetch written here.
 *
 * The client builds the gateway URL its own way, and a check that authenticates
 * against a different URL would pass while the product's requests fail. Proving
 * the credential against the path the product uses is the whole point.
 *
 * `_meta` rather than an agent query: the Agent0 schema is not corrected until
 * task 4.1, so a query naming entity fields would fail for a schema reason and
 * report as a credential problem — the exact confusion this gate prevents.
 * `_meta` is present on every subgraph, needs authentication, and returns the
 * indexed head, which also shows the subgraph is live rather than merely
 * reachable.
 */
async function checkGraph(): Promise<void> {
  if (!process.env["GRAPH_API_KEY"]) {
    record({
      provider: "graph",
      name: "authenticated subgraph query",
      passed: false,
      code: "unset",
      detail: "GRAPH_API_KEY is empty; every task in section 4 is blocked",
    });
    return;
  }

  try {
    const client = new Agent0Client({ network: "sepolia" });
    const data = await client.query<{
      _meta: { block: { number: number }; hasIndexingErrors: boolean };
    }>("{ _meta { block { number } hasIndexingErrors } }");

    record({
      provider: "graph",
      name: "authenticated subgraph query",
      passed: true,
      code: "200",
      detail: `indexed head ${data._meta.block.number}, indexing errors: ${data._meta.hasIndexingErrors}`,
    });
  } catch (error) {
    record({
      provider: "graph",
      name: "authenticated subgraph query",
      passed: false,
      code: "rejected",
      detail: reasonOf(error),
    });
  }
}

//////////////////////////////////////////////////////////////////////////////
// Gate 0.2 — Privy
//////////////////////////////////////////////////////////////////////////////

/**
 * `GET /v1/wallets` with Basic auth and the `privy-app-id` header, per Privy's
 * API reference. The app's own wallet list is the cheapest read that cannot
 * succeed without both the app id and the app secret being correct.
 *
 * The two authorization-key variables are checked separately and reported as
 * their own line, because they gate a different thing: the app credentials
 * authenticate reads, and the authorization key signs wallet *actions*. A run
 * that can list wallets but not sign one is a run that discovers the problem
 * inside Gate C.
 */
async function checkPrivy(): Promise<void> {
  const appId = process.env["NEXT_PUBLIC_PRIVY_APP_ID"];
  const appSecret = process.env["PRIVY_APP_SECRET"];

  if (!appId || !appSecret) {
    record({
      provider: "privy",
      name: "authenticated wallet list",
      passed: false,
      code: "unset",
      detail: "NEXT_PUBLIC_PRIVY_APP_ID or PRIVY_APP_SECRET is empty",
    });
  } else {
    try {
      const response = await fetch("https://api.privy.io/v1/wallets", {
        method: "GET",
        headers: {
          authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString("base64")}`,
          "privy-app-id": appId,
          "content-type": "application/json",
        },
      });

      const body = (await response.json().catch(() => ({}))) as {
        data?: unknown[];
        error?: string;
        message?: string;
      };

      record({
        provider: "privy",
        name: "authenticated wallet list",
        passed: response.ok && Array.isArray(body.data),
        code: String(response.status),
        detail: response.ok
          ? `${body.data?.length ?? 0} wallets on app ${appId}`
          : (body.error ?? body.message ?? response.statusText),
      });
    } catch (error) {
      record({
        provider: "privy",
        name: "authenticated wallet list",
        passed: false,
        code: "network-error",
        detail: reasonOf(error),
      });
    }
  }

  // The signing half. There is no read that exercises an authorization key
  // without creating or mutating a wallet, so this one is a presence check and
  // says so rather than pretending to be a round trip.
  const missing = (
    ["PRIVY_AUTHORIZATION_KEY_ID", "PRIVY_AUTHORIZATION_PRIVATE_KEY"] as const
  ).filter((name) => !process.env[name]);

  record({
    provider: "privy",
    name: "authorization key is configured (presence only — signs wallet actions)",
    passed: missing.length === 0,
    code: missing.length === 0 ? "present" : "unset",
    detail:
      missing.length === 0
        ? "first proved by the signed request in Gate C"
        : `${missing.join(", ")}; every task in section 5 is blocked`,
  });
}

//////////////////////////////////////////////////////////////////////////////
// Gemini — the discovery ranking step (design.md D12)
//////////////////////////////////////////////////////////////////////////////

async function checkGemini(): Promise<void> {
  const key = process.env["GEMINI_API_KEY"];
  if (!key) {
    record({
      provider: "gemini",
      name: "authenticated model list",
      passed: false,
      code: "unset",
      detail: "GEMINI_API_KEY is empty; the ranking step in section 4 is blocked",
    });
    return;
  }

  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models",
      { headers: { "x-goog-api-key": key } },
    );
    const body = (await response.json().catch(() => ({}))) as {
      models?: unknown[];
      error?: { message?: string };
    };

    record({
      provider: "gemini",
      name: "authenticated model list",
      passed: response.ok && Array.isArray(body.models),
      code: String(response.status),
      detail: response.ok
        ? `${body.models?.length ?? 0} models visible to this key`
        : (body.error?.message ?? response.statusText),
    });
  } catch (error) {
    record({
      provider: "gemini",
      name: "authenticated model list",
      passed: false,
      code: "network-error",
      detail: reasonOf(error),
    });
  }
}

//////////////////////////////////////////////////////////////////////////////
// Postgres — the coordination store (design.md D12)
//////////////////////////////////////////////////////////////////////////////

/**
 * A real connection and a real query, not a parse of the URL.
 *
 * `DATABASE_URL` has a working-looking default in `.env.example`, which makes
 * it the variable most likely to be present and wrong. The restart test in
 * task 2.6 is the assertion that ultimately depends on this, and discovering a
 * refused connection there means debugging durability rather than a service.
 */
async function checkPostgres(): Promise<void> {
  const url = process.env["DATABASE_URL"];
  if (!url) {
    record({
      provider: "postgres",
      name: "connect and query",
      passed: false,
      code: "unset",
      detail: "DATABASE_URL is empty; the coordination store cannot start",
    });
    return;
  }

  const { Client } = await import("pg");
  const client = new Client({ connectionString: url });

  try {
    await client.connect();
    const { rows } = await client.query<{ version: string }>(
      "select version() as version",
    );
    record({
      provider: "postgres",
      name: "connect and query",
      passed: true,
      code: "connected",
      detail: (rows[0]?.version ?? "").split(" ").slice(0, 2).join(" "),
    });
  } catch (error) {
    record({
      provider: "postgres",
      name: "connect and query",
      passed: false,
      code: "refused",
      detail: reasonOf(error),
    });
  } finally {
    await client.end().catch(() => {});
  }
}

//////////////////////////////////////////////////////////////////////////////
// Runner
//////////////////////////////////////////////////////////////////////////////

async function main(): Promise<void> {
  console.log("Gate 0 — credentials are real\n");

  const config = chainConfig();
  const organizationKey = process.env["ENSV2_ORGANIZATION_PRIVATE_KEY"];
  const controllerKey = process.env["ENSV2_AGENT_CONTROLLER_PRIVATE_KEY"];

  if (organizationKey && controllerKey) {
    // The client's constructor throws when the two keys collide, so it is
    // built inside the try that reports that collision as a gate failure
    // rather than as a stack trace.
    let client: ViemChainClient | undefined;
    try {
      client = createViemChainClient({
        rpcUrl: config.rpcUrl,
        chainId: config.chainId,
        organizationKey: organizationKey as Hex,
        controllerKey: controllerKey as Hex,
      });
    } catch (error) {
      record({
        provider: "keys",
        name: "organization and controller are different accounts",
        passed: false,
        code: "identical",
        detail: reasonOf(error),
      });
    }

    if (client) {
      checkSigners(client);
      await checkBalance(client, "organization");
      await checkBalance(client, "controller");
      await checkCode(
        client,
        "parent registry proxy",
        config.deployed.parentRegistry,
        "ENSV2_PARENT_REGISTRY_ADDRESS",
      );
      await checkCode(
        client,
        "permissioned resolver proxy",
        config.deployed.permissionedResolver,
        "ENSV2_PERMISSIONED_RESOLVER_ADDRESS",
      );
      await checkCode(
        client,
        "ERC 8004 identity registry",
        config.erc8004.identityRegistry,
        "ERC8004_IDENTITY_REGISTRY_ADDRESS",
      );
      await checkParentWiring(client);
    }
  } else {
    record({
      provider: "keys",
      name: "both testnet keys are configured",
      passed: false,
      code: "unset",
      detail:
        "ENSV2_ORGANIZATION_PRIVATE_KEY or ENSV2_AGENT_CONTROLLER_PRIVATE_KEY is empty",
    });
  }

  await checkGraph();
  await checkPrivy();
  await checkGemini();
  await checkPostgres();

  const failures = results.filter((r) => !r.passed && !r.advisory);
  console.log(
    `\n${results.length - failures.length}/${results.length} checks passed`,
  );

  if (failures.length === 0) {
    console.log("Gate 0: pass — every provider answered its own round trip.");
    return;
  }

  console.log("\nGate 0: fail. Blocked until each of these is a real credential:");
  for (const failure of failures) {
    console.log(`  ${failure.provider}: ${failure.name} (${failure.code})`);
  }
  process.exitCode = 1;
}

// Not top-level `await`: the root package is CommonJS, so tsx transforms this
// file with esbuild's cjs output format, which rejects it outright.
main().catch((error: unknown) => {
  console.error(`Gate 0 could not run: ${reasonOf(error)}`);
  process.exitCode = 1;
});
