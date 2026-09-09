/**
 * Provision the fleet onto ENSv2 — tasks 3.1 through 3.7, and 7.19.
 *
 * Idempotent. Every step checks chain state before spending, so a re-run after
 * a partial failure repairs rather than duplicates. That property lives in
 * `provisionAgent`, which this script and `POST /v1/agents` both call: the
 * sequence had to stop being a script-only implementation the moment the
 * console grew a create screen — design D7 of `add-agent-provisioning`.
 *
 * What stays here is what is genuinely fleet-shaped: the three-agent list from
 * ADR 008, and the two assertions that only mean anything across names — that
 * no wildcard grant exists, and that the research controller's grant does not
 * reach the other two.
 */

import { formatEther } from "viem";
import {
  provisionAgent,
  type ProvisionStep,
  type ProvisionTarget,
} from "@nymspace/api/provisioning";
import { requireServerEnv } from "@nymspace/core/env";
import type { Hex } from "@nymspace/core";
import {
  AGENT_CONTEXT_KEY,
  EnsService,
  RESOLVER_ROLE,
  agentEndpointKey,
  chainConfig,
  createViemChainClient,
  requireDeployed,
  wildcardTextResource,
  type ViemChainClient,
} from "@nymspace/ens";
import { Store, closeDatabase, database, migrate } from "@nymspace/store";

//////////////////////////////////////////////////////////////////////////////
// The fleet
//////////////////////////////////////////////////////////////////////////////

const ORGANIZATION_ID = "nymspace";

/**
 * Three agents, per ADR 008, and only the research agent is delegated to.
 *
 * `docs/14`'s cut list drops the deploy agent first and the trader's
 * interactions second, so those two exist to prove the fleet is a fleet — that
 * grants are scoped per name — while the research agent carries the actual
 * proof. Giving all three controllers grants would cost gas and prove less:
 * task 3.7 needs a name whose controller has *no* grant to check leakage
 * against.
 */
const AGENTS: Omit<ProvisionTarget, "controller">[] = [
  {
    label: "research",
    name: "Research",
    description: "Finds and ranks other agents from live registry data.",
    role: "Reads discovery data and may update its own MCP endpoint record.",
    endpoints: { mcp: "https://mcp.nymspace.example/research" },
    delegate: true,
  },
  {
    label: "trader",
    name: "Trader",
    description: "Executes payments inside a policy it cannot change.",
    role: "Holds a wallet under an amount-based policy. No record delegation.",
    endpoints: {},
    delegate: false,
  },
  {
    label: "deploy",
    name: "Deploy",
    description: "Provisions and retires agents on behalf of the organization.",
    role: "Reserved. First on the cut list in docs/14.",
    endpoints: {},
    delegate: false,
  },
];

//////////////////////////////////////////////////////////////////////////////
// Reporting
//////////////////////////////////////////////////////////////////////////////

const steps: ProvisionStep[] = [];

function report(entry: ProvisionStep): ProvisionStep {
  steps.push(entry);
  console.log(
    `${entry.ok ? "ok  " : "FAIL"}  ${entry.what.padEnd(52)} ${entry.detail}`,
  );
  return entry;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0]! : String(error);
}

//////////////////////////////////////////////////////////////////////////////
// Runner
//////////////////////////////////////////////////////////////////////////////

async function main(): Promise<void> {
  const config = chainConfig();
  const deployed = requireDeployed(config);
  const keys = requireServerEnv([
    "ENSV2_ORGANIZATION_PRIVATE_KEY",
    "ENSV2_AGENT_CONTROLLER_PRIVATE_KEY",
  ] as const);

  const client: ViemChainClient = createViemChainClient({
    rpcUrl: config.rpcUrl,
    chainId: config.chainId,
    organizationKey: keys.ENSV2_ORGANIZATION_PRIVATE_KEY as Hex,
    controllerKey: keys.ENSV2_AGENT_CONTROLLER_PRIVATE_KEY as Hex,
  });

  const ens = new EnsService({ client, config });
  const parentName = `${deployed.parentLabel}.eth`;
  const registry = deployed.parentRegistry;

  console.log(`Provisioning ${AGENTS.length} agents under ${parentName}`);
  console.log(`  registry  ${registry}`);
  console.log(`  resolver  ${deployed.permissionedResolver}`);
  console.log(`  organization ${client.organization}`);
  console.log(`  controller   ${client.controller}`);
  console.log(
    `  balance      ${formatEther(await client.getBalance(client.organization))} ETH\n`,
  );

  const db = database();
  await migrate(db);
  const store = new Store(db);

  await store.upsertOrganization({
    id: ORGANIZATION_ID,
    displayName: "Nymspace",
    parentEnsName: parentName,
    chainId: config.chainId,
  });

  const context = {
    ens,
    store,
    organizationId: ORGANIZATION_ID,
    parentName,
    registry,
    resolver: deployed.permissionedResolver,
    organization: client.organization,
  };

  for (const agent of AGENTS) {
    try {
      const result = await provisionAgent(context, {
        ...agent,
        controller: client.controller,
      });
      for (const entry of result.steps) report(entry);
    } catch (error) {
      report({
        what: `provision ${agent.label}`,
        ok: false,
        skipped: false,
        detail: messageOf(error),
      });
    }
  }

  //////////////////////////////////////////////////////////////////////////
  // 3.6 — the wildcard is empty, on every name
  //////////////////////////////////////////////////////////////////////////

  /**
   * One shared resolver serves all three agents, so a single wildcard grant
   * would let the research controller rewrite that key on every name in the
   * resolver. Asserted per key rather than assumed, because nothing in the
   * grant path constructs a wildcard and the assertion is what proves it.
   */
  const mcpKey = agentEndpointKey("mcp");

  for (const key of [mcpKey, AGENT_CONTEXT_KEY]) {
    const held = await ens.resolverHasRoles(
      wildcardTextResource(key),
      RESOLVER_ROLE.SET_TEXT,
      client.controller,
    );
    report({
      what: `3.6 wildcard empty for ${key}`,
      ok: !held,
      skipped: false,
      detail: held
        ? "CONTROLLER HOLDS THE WILDCARD — it can rewrite this key on every name"
        : "no wildcard grant",
    });
  }

  //////////////////////////////////////////////////////////////////////////
  // 3.7 — grants do not leak across names
  //////////////////////////////////////////////////////////////////////////

  for (const agent of AGENTS.filter((a) => !a.delegate)) {
    const otherName = `${agent.label}.${parentName}`;
    // `canSetText` rather than a single resource read: it evaluates all three
    // alternatives the resolver's own `onlyPartRoles` accepts, so a leak
    // through the name-level or wildcard resource cannot hide from it.
    const canWrite = await ens.canSetText(otherName, mcpKey, client.controller);
    report({
      what: `3.7 no leak onto ${agent.label}`,
      ok: !canWrite,
      skipped: false,
      detail: canWrite
        ? `LEAK — the research controller can write ${mcpKey} on ${otherName}`
        : `research controller cannot write ${mcpKey} on ${otherName}`,
    });
  }

  //////////////////////////////////////////////////////////////////////////

  const failures = steps.filter((s) => !s.ok);
  console.log(`\n${steps.length - failures.length}/${steps.length} steps passed`);
  console.log(
    `balance after: ${formatEther(await client.getBalance(client.organization))} ETH`,
  );

  if (failures.length > 0) {
    console.log("\nFailed:");
    for (const failure of failures) {
      console.log(`  ${failure.what}: ${failure.detail}`);
    }
    process.exitCode = 1;
  }

  await closeDatabase();
}

// Not top-level `await`: the root package is CommonJS, so tsx transforms this
// file with esbuild's cjs output format, which rejects it.
main().catch(async (error: unknown) => {
  console.error(`provisioning failed: ${messageOf(error)}`);
  process.exitCode = 1;
  await closeDatabase().catch(() => {});
});
