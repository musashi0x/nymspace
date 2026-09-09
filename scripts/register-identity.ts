/**
 * Bind the research agent's ENS name to an ERC 8004 registration — tasks 3.8,
 * 3.9, 3.11 and 3.12.
 *
 * Run: pnpm register:identity
 *
 * Two chains, deliberately. The name lives on Sepolia because ENSv2 exists only
 * there; the registration lives on Base Sepolia because Ethereum Sepolia's
 * Agent0 indexer is stuck and a registration nothing can index proves nothing
 * downstream (design.md D14). The ENSIP 25 key carries the difference and
 * nothing else does: chain reference `0x014a34` rather than `0xaa36a7`.
 *
 * The four steps, in the order that makes each one meaningful:
 *
 *   3.8  register on Base Sepolia, with the ENS name claimed in the file
 *   3.9  read the registration back and confirm the claim
 *   3.11 write the ENSIP 25 record on Sepolia, from the organization key
 *   3.12 attempt the same write from the controller, and require a revert
 *
 * 3.12 comes last because it is only a proof once 3.11 has succeeded. A write
 * that reverts before anyone has shown the same write can succeed is a write
 * that might be failing for any reason at all.
 */

import { formatEther } from "viem";
import { requireServerEnv } from "@nymspace/core/env";
import type { Address, Hex } from "@nymspace/core";
import {
  EnsService,
  Erc8004Service,
  agentRegistrationKey,
  buildRegistrationFile,
  chainConfig,
  claimedEnsName,
  createViemChainClient,
  encodeRegistrationFileUri,
  requireDeployed,
  verifyEnsip25,
  type ViemChainClient,
} from "@nymspace/ens";
import { Agent0Client } from "@nymspace/graph";
import { Store, closeDatabase, database, migrate } from "@nymspace/store";

const ORGANIZATION_ID = "nymspace";
const AGENT_SLUG = "research";
const AGENT_DB_ID = `agent-${AGENT_SLUG}`;

/** Base Sepolia. The registry address is identical to Sepolia's. */
const REGISTRATION_CHAIN_ID = 84532;

const MCP_ENDPOINT = "https://mcp.nymspace.example/research";

//////////////////////////////////////////////////////////////////////////////

interface Step {
  what: string;
  ok: boolean;
  detail: string;
  txHash?: Hex;
}

const steps: Step[] = [];

function step(entry: Step): Step {
  steps.push(entry);
  console.log(
    `${entry.ok ? "ok  " : "FAIL"}  ${entry.what.padEnd(46)} ${entry.detail}`,
  );
  return entry;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0]! : String(error);
}

/** The whole error, for the revert-cause assertion. */
function fullMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

//////////////////////////////////////////////////////////////////////////////

async function main(): Promise<void> {
  const config = chainConfig();
  const deployed = requireDeployed(config);
  const keys = requireServerEnv([
    "ENSV2_ORGANIZATION_PRIVATE_KEY",
    "ENSV2_AGENT_CONTROLLER_PRIVATE_KEY",
    "ERC8004_BASE_SEPOLIA_IDENTITY_REGISTRY_ADDRESS",
  ] as const);

  const organizationKey = keys.ENSV2_ORGANIZATION_PRIVATE_KEY as Hex;
  const controllerKey = keys.ENSV2_AGENT_CONTROLLER_PRIVATE_KEY as Hex;
  const registry = keys
    .ERC8004_BASE_SEPOLIA_IDENTITY_REGISTRY_ADDRESS as Address;

  // Sepolia — the name and every record on it.
  const ensClient: ViemChainClient = createViemChainClient({
    rpcUrl: config.rpcUrl,
    chainId: config.chainId,
    organizationKey,
    controllerKey,
  });

  // Base Sepolia — the registration only.
  const registrationClient: ViemChainClient = createViemChainClient({
    rpcUrl:
      process.env["BASE_SEPOLIA_RPC_URL"] ?? "https://sepolia.base.org",
    chainId: REGISTRATION_CHAIN_ID,
    organizationKey,
    controllerKey,
  });

  const ens = new EnsService({ client: ensClient, config });
  const erc8004 = new Erc8004Service({
    client: registrationClient,
    registry,
    chainId: REGISTRATION_CHAIN_ID,
  });

  const ensName = `${AGENT_SLUG}.${deployed.parentLabel}.eth`;

  console.log(`Binding ${ensName}`);
  console.log(`  ENS            chain ${config.chainId}, resolver ${deployed.permissionedResolver}`);
  console.log(`  registration   chain ${REGISTRATION_CHAIN_ID}, registry ${registry}`);
  console.log(`  organization   ${ensClient.organization}`);
  console.log(`  controller     ${ensClient.controller}`);
  console.log(
    `  base balance   ${formatEther(await registrationClient.getBalance(registrationClient.organization))} ETH\n`,
  );

  const db = database();
  await migrate(db);
  const store = new Store(db);

  const existing = await store.getAgent(AGENT_DB_ID);
  if (!existing) {
    throw new Error(
      `${AGENT_DB_ID} is not in the store. Run \`pnpm provision:fleet\` first.`,
    );
  }

  ////////////////////////////////////////////////////////////////////////////
  // 3.8 — register on Base Sepolia
  ////////////////////////////////////////////////////////////////////////////

  const file = buildRegistrationFile({
    name: "Nymspace Research",
    description:
      "Finds and ranks agents from live ERC 8004 registry data. Operated by nymspace.eth.",
    ensName,
    mcpEndpoint: MCP_ENDPOINT,
    // Only what is actually true. `supportedTrusts` naming a scheme nobody
    // implements would be a claim the agent cannot back, which is the same
    // failure as an endpoint that does not answer.
    supportedTrusts: [],
  });

  let agentId = existing.erc8004AgentId;

  if (agentId) {
    step({
      what: "3.8 ERC 8004 registration",
      ok: true,
      detail: `already registered as agent ${agentId}, not re-registering`,
    });
  } else {
    const uri = encodeRegistrationFileUri(file);
    console.log(`      agentURI is ${uri.length} bytes of calldata\n`);

    const registration = await erc8004.register({ file, as: "organization" });
    agentId = registration.agentId;

    step({
      what: "3.8 ERC 8004 registration",
      ok: true,
      detail: `agent ${agentId}, tx ${registration.transactionHash}`,
      txHash: registration.transactionHash,
    });

    await store.upsertAgent({
      id: AGENT_DB_ID,
      organizationId: ORGANIZATION_ID,
      slug: AGENT_SLUG,
      ensName,
      controllerAddress: ensClient.controller,
      erc8004AgentId: agentId,
      erc8004Registry: registry,
    });

    await store.recordEvent({
      organizationId: ORGANIZATION_ID,
      agentId: AGENT_DB_ID,
      source: "erc8004",
      type: "erc8004.registered",
      status: "success",
      occurredAt: new Date().toISOString(),
      actor: registrationClient.organization,
      txHash: registration.transactionHash,
      externalId: `${REGISTRATION_CHAIN_ID}:${agentId}`,
      summary: `Registered ${ensName} as ERC 8004 agent ${agentId} on Base Sepolia`,
      evidence: {
        source: "erc8004",
        txHash: registration.transactionHash,
        contractAddress: registry,
        chainId: REGISTRATION_CHAIN_ID,
      },
    });
  }

  await store.setProvisioning(AGENT_DB_ID, { erc8004: "registered" });

  ////////////////////////////////////////////////////////////////////////////
  // 3.9 — the registration claims the ENS name
  ////////////////////////////////////////////////////////////////////////////

  const onChainFile = await erc8004.registrationFile(agentId);
  const claim = onChainFile ? claimedEnsName(onChainFile) : undefined;

  step({
    what: "3.9 registration claims the ENS name",
    ok: claim?.toLowerCase() === ensName.toLowerCase(),
    detail: claim
      ? `services[ens] = ${claim}`
      : "the registration file carries no ens service entry",
  });

  ////////////////////////////////////////////////////////////////////////////
  // 3.10 — the key, asserted against the live values rather than a fixture
  ////////////////////////////////////////////////////////////////////////////

  const key = agentRegistrationKey({
    chainId: REGISTRATION_CHAIN_ID,
    registry,
    agentId,
  });

  step({
    what: "3.10 ENSIP 25 key is canonical",
    ok:
      key === key.toLowerCase() &&
      !/\s/.test(key) &&
      key.includes("014a34") &&
      key.endsWith(`][${agentId}]`),
    detail: key,
  });

  ////////////////////////////////////////////////////////////////////////////
  // 3.11 — write it, from the organization key
  ////////////////////////////////////////////////////////////////////////////

  const before = await ens.readText(ensName, key);
  if (before.length > 0) {
    step({
      what: "3.11 organization writes the record",
      ok: true,
      detail: `already set to ${JSON.stringify(before)}`,
    });
  } else {
    const hash = await ens.writeText({
      name: ensName,
      key,
      // ENSIP 25: clients MUST NOT depend on the value beyond it being
      // non-empty. "1" is the published convention and carries no meaning.
      value: "1",
      as: "organization",
    });
    const receipt = await ens.waitForReceipt(hash);
    const after = await ens.readText(ensName, key);

    step({
      what: "3.11 organization writes the record",
      ok: receipt.status === "success" && after === "1" && after !== before,
      detail: `${hash}, read back ${JSON.stringify(after)} (was ${JSON.stringify(before)})`,
      txHash: hash,
    });

    await store.recordEvent({
      organizationId: ORGANIZATION_ID,
      agentId: AGENT_DB_ID,
      source: "ens",
      type: "ens.record.updated",
      status: "success",
      occurredAt: new Date().toISOString(),
      actor: ensClient.organization,
      txHash: hash,
      summary: `Wrote the ENSIP 25 registration record on ${ensName}`,
      evidence: {
        source: "ens",
        txHash: hash,
        contractAddress: deployed.permissionedResolver,
      },
    });
  }

  ////////////////////////////////////////////////////////////////////////////
  // 3.12 — the controller cannot write it
  ////////////////////////////////////////////////////////////////////////////

  /**
   * The proof the whole change rests on, and the one most easily faked by
   * accident. A revert is a weak signal: out of gas, a stale nonce, an empty
   * balance and a malformed call all revert and all render identically in a
   * pass/fail line. So this asserts the *cause* — the resolver's own
   * `EACUnauthorizedAccountRoles` — which is why the error fragments were added
   * to the pinned ABI. Without them viem reports a bare selector and the
   * assertion degrades to "something went wrong".
   *
   * The differential control is 3.11 immediately above: the identical write,
   * to the identical key, on the identical name, succeeded from the other
   * signer moments ago. The only variable is who signed.
   */
  let denied = false;
  let revertDetail = "the write succeeded — the boundary does not hold";

  try {
    await ens.writeText({
      name: ensName,
      key,
      value: "controller-should-not-be-able-to-write-this",
      as: "controller",
    });
  } catch (error) {
    denied = true;
    revertDetail = fullMessage(error);
  }

  const namedTheRightError = revertDetail.includes(
    "EACUnauthorizedAccountRoles",
  );

  step({
    what: "3.12 controller is denied the ENSIP 25 key",
    ok: denied && namedTheRightError,
    detail: denied
      ? namedTheRightError
        ? "reverted with EACUnauthorizedAccountRoles"
        : `reverted, but not with the resolver's own error: ${messageOf(revertDetail)}`
      : revertDetail,
  });

  if (denied) {
    await store.recordEvent({
      organizationId: ORGANIZATION_ID,
      agentId: AGENT_DB_ID,
      source: "ens",
      type: "ens.action.denied",
      status: "denied",
      occurredAt: new Date().toISOString(),
      actor: ensClient.controller,
      summary: `Controller was denied ${key} on ${ensName}`,
      evidence: {
        source: "ens",
        // The denial never reached a block, so the evidence is the write that
        // proves the same call succeeds for the organization.
        txHash:
          steps.find((s) => s.what === "3.11 organization writes the record")
            ?.txHash ?? (`0x${"0".repeat(64)}` as Hex),
        contractAddress: deployed.permissionedResolver,
      },
      metadata: {
        deniedTo: ensClient.controller,
        allowedFor: ensClient.organization,
        revertReason: namedTheRightError
          ? "EACUnauthorizedAccountRoles"
          : "unknown",
      },
    });
  }

  ////////////////////////////////////////////////////////////////////////////
  // Verification, end to end
  ////////////////////////////////////////////////////////////////////////////

  const verification = await verifyEnsip25({
    ensName,
    agentId,
    registry,
    chainId: REGISTRATION_CHAIN_ID,
    erc8004,
    readText: (name, k) => ens.readText(name, k),
  });

  step({
    what: "3.13 runtime verification",
    ok: verification.status === "verified",
    detail: `${verification.status}, read at ${verification.readAt}`,
  });

  await store.setProvisioning(AGENT_DB_ID, {
    ensip25: verification.status,
  });

  if (verification.status === "verified") {
    await store.recordEvent({
      organizationId: ORGANIZATION_ID,
      agentId: AGENT_DB_ID,
      source: "erc8004",
      type: "ensip25.verified",
      status: "success",
      occurredAt: verification.readAt,
      summary: `${ensName} and agent ${agentId} confirm each other`,
      evidence: {
        source: "erc8004",
        txHash:
          steps.find((s) => s.what === "3.8 ERC 8004 registration")?.txHash ??
          (`0x${"0".repeat(64)}` as Hex),
        contractAddress: registry,
        chainId: REGISTRATION_CHAIN_ID,
      },
    });
  }

  ////////////////////////////////////////////////////////////////////////////
  // 4.6 — is the registration indexed yet?
  ////////////////////////////////////////////////////////////////////////////

  /**
   * `docs/17` Risk 3 has no engineering mitigation, so the honest thing is to
   * ask and record the answer rather than assume either way.
   *
   * The fleet card was reading `not_indexed` for an agent the subgraph was
   * already returning, because nothing ever advanced the track after
   * registration. A status that only ever moves in one direction is a status
   * that stops describing the system.
   */
  try {
    const graph = new Agent0Client();
    const key = `${REGISTRATION_CHAIN_ID}:${agentId}`;
    const indexed = await graph.agentProfile(key);

    await store.setProvisioning(AGENT_DB_ID, {
      graph: indexed ? "indexed" : "pending",
    });

    step({
      what: "4.6 registration is indexed",
      ok: true,
      detail: indexed
        ? `${key} returns ${indexed.claimedEnsName ?? "no ENS claim"} — discoverable`
        : `${key} not indexed yet; the registration transaction stands as evidence meanwhile`,
    });

    if (indexed) {
      await store.recordEvent({
        organizationId: ORGANIZATION_ID,
        agentId: AGENT_DB_ID,
        source: "graph",
        type: "graph.indexed",
        status: "success",
        occurredAt: indexed.provenance.queriedAt,
        summary: `${key} is indexed and claims ${indexed.claimedEnsName ?? "no name"}`,
        evidence: {
          source: "graph",
          chainId: indexed.provenance.chainId,
          subgraphId: indexed.provenance.subgraphId,
          queriedAt: indexed.provenance.queriedAt,
          graphEntityId: key,
        },
      });
    }
  } catch (error) {
    // A provider outage is not "not indexed" — it is not knowing, and the
    // track says so rather than reporting an absence it did not establish.
    await store.setProvisioning(AGENT_DB_ID, { graph: "provider_error" });
    step({
      what: "4.6 registration is indexed",
      ok: false,
      detail: `could not ask the subgraph: ${messageOf(error)}`,
    });
  }

  ////////////////////////////////////////////////////////////////////////////

  const failures = steps.filter((s) => !s.ok);
  console.log(`\n${steps.length - failures.length}/${steps.length} steps passed`);
  console.log(
    `base balance after: ${formatEther(await registrationClient.getBalance(registrationClient.organization))} ETH`,
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

main().catch(async (error: unknown) => {
  console.error(`identity binding failed: ${messageOf(error)}`);
  process.exitCode = 1;
  await closeDatabase().catch(() => {});
});
