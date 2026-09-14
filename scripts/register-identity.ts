/**
 * Bind an agent's ENS name to an ERC 8004 registration — tasks 3.8 through
 * 3.13, and 4.6.
 *
 * Run: pnpm register:identity
 *
 * Two chains, deliberately. The name lives on Sepolia because ENSv2 exists only
 * there; the registration lives on Base Sepolia because Ethereum Sepolia's
 * Agent0 indexer is stuck and a registration nothing can index proves nothing
 * downstream (design.md D14). The ENSIP 25 key carries the difference and
 * nothing else does: chain reference `0x014a34` rather than `0xaa36a7`.
 *
 * The registration itself — 3.8 register, 3.9 read the claim back, 3.11 write
 * the ENSIP 25 record, 3.13 verify, 4.6 ask the subgraph whether it is indexed
 * yet — is `bindRegistration`, the same function `POST /v1/agents` runs once it
 * has provisioned a name. Two copies of those steps would diverge on the first
 * fix. What stays here is what only a script holding both keys does:
 *
 *   adopt an existing registration by id, instead of paying for a second one
 *   3.10 assert the key is canonical, against live values
 *   3.12 attempt the ENSIP 25 write from the controller, and require a revert
 *
 * 3.12 runs only once verification has passed. A write that reverts before
 * anyone has shown the same write can succeed is a write that might be failing
 * for any reason at all.
 */

import { formatEther } from "viem";
import { bindRegistration } from "@nymspace/api/provisioning";
import { requireServerEnv } from "@nymspace/core/env";
import {
  fleetAgent,
  publishableAgentMcpEndpoint,
  type Address,
  type Hex,
} from "@nymspace/core";
import {
  EnsService,
  Erc8004Service,
  chainConfig,
  claimedEnsName,
  createViemChainClient,
  requireDeployed,
  type ViemChainClient,
} from "@nymspace/ens";
import { Agent0Client } from "@nymspace/graph";
import { Store, closeDatabase, database, migrate } from "@nymspace/store";

const ORGANIZATION_ID = "nymspace";

/**
 * Which agent gets registered. Overridable, because which one is a choice.
 *
 * `research` by default, since it is the one `docs/02`'s golden path walks and
 * the one every gate asserts on. It was the only one for as long as it was the
 * only agent with a registration — and then a second agent needed one, and the
 * hardcoded slug meant editing this file to get it. The same shape
 * `bind-wallet.ts` already uses for the same reason.
 */
const AGENT_SLUG = process.env["REGISTER_AGENT_SLUG"] ?? "research";
const AGENT_DB_ID = `agent-${AGENT_SLUG}`;

/**
 * Adopt an existing registration instead of creating one.
 *
 * `bindRegistration` reads `store.getAgent().erc8004AgentId` to decide whether
 * to register, so against a store that does not know the id — a database
 * restored from elsewhere, recreated for local work, or simply a different
 * deployment than the one the registration was made from — it does not adopt.
 * It registers again, and the organization ends up paying for a second agent
 * id claiming the same ENS name, with the store pointing at the newer one and
 * the subgraph holding both. Exactly the failure `bind-wallet.ts` exists to
 * undo for wallets.
 *
 * It cannot be discovered: the registry is keyed by agent id, so there is no
 * name-to-id lookup on chain, and resolving it through the subgraph's text
 * search would make an identity binding depend on a fuzzy match. So it is
 * supplied, and then *verified* — the id is only written to the store once the
 * registration on chain is read back and found to claim this exact name.
 */
const ADOPT_AGENT_ID = process.env["REGISTER_AGENT_ID"];

/** Base Sepolia. The registry address is identical to Sepolia's. */
const REGISTRATION_CHAIN_ID = 84532;

const ZERO_HASH = `0x${"0".repeat(64)}` as Hex;

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

  // Derived, and refused unless https, before anything is spent. The endpoint
  // goes into the registration file on Base Sepolia and from there into
  // Agent0's index, where a local value would be published to everyone.
  const mcpEndpoint = publishableAgentMcpEndpoint(
    process.env["AGENT_MCP_BASE_URL"],
    AGENT_SLUG,
  );

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

  /*
    Name and description from `FLEET`, not from a literal here.

    They were "Nymspace Research" and a sentence about ranking agents, which is
    true of exactly one agent and was about to be written into a second one's
    registration on a public registry. `FLEET` is where the console, the MCP
    servers and `provision-fleet.ts` already read an agent's identity from, so
    an agent describes itself the same way everywhere or the difference is a
    bug somebody has to notice.
  */
  const identity = fleetAgent(AGENT_SLUG);
  if (!identity) {
    throw new Error(
      `${AGENT_SLUG} is not in FLEET. Add it to packages/core/src/fleet.ts first — ` +
        "a registration published from a name this process invented would claim " +
        "something no other screen agrees with. An agent created in the console " +
        "is registered by `POST /v1/agents` itself; re-post its label to repair it.",
    );
  }

  ////////////////////////////////////////////////////////////////////////////
  // Adopt — an id supplied by hand, believed only once the chain agrees
  ////////////////////////////////////////////////////////////////////////////

  /*
    The registration file is the authority on which name a registration claims,
    so adopting is "read it and see". A mismatch throws rather than warning:
    writing the wrong id into the store would point this agent's ENSIP 25 key
    at somebody else's registration, and the verification in 3.13 would then
    fail for a reason that looks nothing like its cause.
  */
  if (!existing.erc8004AgentId && ADOPT_AGENT_ID) {
    const adopted = await erc8004.registrationFile(ADOPT_AGENT_ID);
    const adoptedClaim = adopted ? claimedEnsName(adopted) : undefined;

    if (adoptedClaim?.toLowerCase() !== ensName.toLowerCase()) {
      throw new Error(
        `REGISTER_AGENT_ID=${ADOPT_AGENT_ID} claims ` +
          `${adoptedClaim ?? "no ENS name"}, not ${ensName}. Refusing to bind a ` +
          "registration that names something else.",
      );
    }

    await store.upsertAgent({
      id: AGENT_DB_ID,
      organizationId: ORGANIZATION_ID,
      slug: AGENT_SLUG,
      ensName,
      controllerAddress: ensClient.controller,
      erc8004AgentId: ADOPT_AGENT_ID,
      erc8004Registry: registry,
    });

    step({
      what: "adopt ERC 8004 registration",
      ok: true,
      detail: `agent ${ADOPT_AGENT_ID} — its registration claims ${adoptedClaim}`,
    });
  }

  ////////////////////////////////////////////////////////////////////////////
  // 3.8, 3.9, 3.11, 3.13 — the steps `POST /v1/agents` runs too
  ////////////////////////////////////////////////////////////////////////////

  const result = await bindRegistration(
    {
      ens,
      erc8004,
      store,
      organizationId: ORGANIZATION_ID,
      resolver: deployed.permissionedResolver,
      organization: ensClient.organization,
      graph: new Agent0Client(),
    },
    {
      agentId: AGENT_DB_ID,
      ensName,
      name: `Nymspace ${identity.name}`,
      description: `${identity.description} Operated by ${deployed.parentLabel}.eth.`,
      endpoints: { mcp: mcpEndpoint },
    },
  );

  for (const entry of result.steps) {
    step({
      what: entry.what,
      ok: entry.ok,
      detail: entry.skipped ? `${entry.detail} (no spend)` : entry.detail,
      ...(entry.txHash && { txHash: entry.txHash }),
    });
  }

  const agentId = result.erc8004AgentId;
  const key = result.key;

  ////////////////////////////////////////////////////////////////////////////
  // 3.10 — the key, asserted against the live values rather than a fixture
  ////////////////////////////////////////////////////////////////////////////

  if (agentId && key) {
    step({
      what: "3.10 ENSIP 25 key is canonical",
      ok:
        key === key.toLowerCase() &&
        !/\s/.test(key) &&
        key.includes("014a34") &&
        key.endsWith(`][${agentId}]`),
      detail: key,
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
   * The differential control is verification passing: it read the identical
   * key on the identical name back non-empty, so the organization's write of it
   * succeeded. The only variable here is who signs.
   */
  if (key && result.ensip25 === "verified") {
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
          txHash: result.bindingTxHash ?? ZERO_HASH,
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
  } else if (key) {
    step({
      what: "3.12 controller is denied the ENSIP 25 key",
      ok: false,
      detail: `not attempted: verification is ${result.ensip25}, so a revert would prove nothing`,
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
