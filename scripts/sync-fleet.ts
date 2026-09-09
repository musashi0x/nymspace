/**
 * Bring the coordination store back in line with the authorities.
 *
 * Run: pnpm sync:fleet
 *
 * `provision:fleet` creates things and needs both private keys to do it. This
 * creates nothing. It reads each authority, writes down what it found, and
 * needs no key material at all — the read half of the split introduced in
 * `openspec/changes/organization-wallet-signing/`.
 *
 * Why it exists: the store records how far *our pipeline* got, which is a
 * different fact from what the authorities say, and the two drift the moment a
 * database is restored from elsewhere, recreated for local work, or migrated.
 * When they drift the console shows five grey badges — indistinguishable from
 * a genuinely unprovisioned fleet, and with the opposite remedy. Re-running
 * `provision:fleet` to fix a stale row spends gas to learn the name already
 * exists; this settles it for nothing.
 *
 * ## What it will and will not write
 *
 * It syncs only the tracks it can actually verify from here, and leaves the
 * rest untouched rather than guessing:
 *
 *   ens       chain read — ownership, resolver, and the agent-context record
 *   erc8004   chain read — the identity registry's owner for the agent id
 *   ensip25   chain read — the registry claim and the ENS record agreeing
 *   graph     NOT synced — needs GRAPH_API_KEY
 *   financial NOT synced — needs the Privy credentials
 *
 * The last two are named in the output as unsynced. A script that silently
 * left two of five tracks stale would be a worse lie than the stale row it was
 * run to fix, because it would look like it had checked.
 */

import { requireServerEnv } from "@nymspace/core/env";
import type { Address } from "@nymspace/core";
import {
  AGENT_CONTEXT_KEY,
  EnsService,
  Erc8004Service,
  chainConfig,
  createViemChainClient,
  requireDeployed,
  verifyEnsip25,
  type Ensip25Status,
} from "@nymspace/ens";
import {
  Store,
  closeDatabase,
  database,
  migrate,
  type EnsProvisioning,
  type Erc8004Provisioning,
  type ProvisioningStatus,
} from "@nymspace/store";

// Must match `provision-fleet.ts` and `apps/api/src/deps.ts`, which is three
// copies of one string. Getting it wrong here does not error — it writes a
// second organization nobody reads, and the console goes empty. It did.
const ORGANIZATION_ID = "nymspace";
const ZERO = "0x0000000000000000000000000000000000000000";

/** ERC 8004 registrations live on Base Sepolia; ENS lives on Sepolia. */
const REGISTRATION_CHAIN_ID = 84532;

/** Kept in step with `provision-fleet.ts` by hand. */
const AGENTS = [
  { slug: "research", displayName: "Research" },
  { slug: "trader", displayName: "Trader" },
  { slug: "deploy", displayName: "Deploy" },
] as const;

interface Finding {
  slug: string;
  ensName: string;
  patch: Partial<ProvisioningStatus>;
  notes: string[];
}

async function main(): Promise<void> {
  const config = chainConfig();
  const deployed = requireDeployed(config);
  const env = requireServerEnv([
    "ENSV2_ORGANIZATION_ADDRESS",
    "ENSV2_AGENT_CONTROLLER_ADDRESS",
  ] as const);

  // Addresses, not keys. Every write method on this client throws
  // `NoSignerError`, which is the guarantee that this script cannot provision
  // by accident.
  const client = createViemChainClient({
    rpcUrl: config.rpcUrl,
    chainId: config.chainId,
    organizationAddress: env.ENSV2_ORGANIZATION_ADDRESS as Address,
    controllerAddress: env.ENSV2_AGENT_CONTROLLER_ADDRESS as Address,
  });

  const ens = new EnsService({ client, config });
  const parentName = `${deployed.parentLabel}.eth`;

  // The ERC 8004 identity lives on Base Sepolia, not on the ENS chain, and the
  // registry is deployed at the same address on both. Reading it through the
  // Sepolia client therefore does not fail — it silently returns a *different*
  // agent that happens to share the id, owned by a stranger. The first version
  // of this script did exactly that and wrote `erc8004=registered` on the
  // strength of it. Hence a second client, and hence `REGISTRATION_CHAIN_ID`
  // spelled out rather than inherited.
  const identityRegistry = process.env[
    "ERC8004_BASE_SEPOLIA_IDENTITY_REGISTRY_ADDRESS"
  ] as Address | undefined;
  const researchAgentId = process.env["ERC8004_RESEARCH_AGENT_ID"];

  const registrationClient = identityRegistry
    ? createViemChainClient({
        rpcUrl: process.env["BASE_SEPOLIA_RPC_URL"] ?? "https://sepolia.base.org",
        chainId: REGISTRATION_CHAIN_ID,
        organizationAddress: env.ENSV2_ORGANIZATION_ADDRESS as Address,
        controllerAddress: env.ENSV2_AGENT_CONTROLLER_ADDRESS as Address,
      })
    : undefined;

  const erc8004 =
    identityRegistry && registrationClient
      ? new Erc8004Service({
          client: registrationClient,
          registry: identityRegistry,
          chainId: REGISTRATION_CHAIN_ID,
        })
      : undefined;

  console.log(`syncing ${AGENTS.length} agents under ${parentName}`);
  console.log(`  resolver  ${deployed.permissionedResolver}`);
  console.log(`  registry  ${deployed.parentRegistry}`);
  console.log(`  no keys used — reads only\n`);

  const db = database();
  await migrate(db);
  const store = new Store(db);

  await store.upsertOrganization({
    id: ORGANIZATION_ID,
    displayName: "Nymspace",
    parentEnsName: parentName,
    chainId: config.chainId,
  });

  const findings: Finding[] = [];

  for (const agent of AGENTS) {
    const ensName = `${agent.slug}.${parentName}`;
    const agentId = `agent-${agent.slug}`;
    const notes: string[] = [];
    const patch: Partial<ProvisioningStatus> = {};

    // --- ENS ------------------------------------------------------------
    // "active" means the name exists AND carries the record the product reads.
    // A registered name with no agent-context is genuinely half-done, and
    // "pending" is the state that says so.
    let ensStatus: EnsProvisioning = "draft";
    try {
      const owner = await ens.findOwner(deployed.parentRegistry, agent.slug);
      if (owner === ZERO) {
        notes.push("not registered on chain");
      } else {
        const context = await ens.readText(ensName, AGENT_CONTEXT_KEY);
        ensStatus = context ? "active" : "pending";
        notes.push(
          context
            ? `registered, agent-context present (owner ${owner.slice(0, 10)}…)`
            : "registered but agent-context is empty",
        );
      }
      patch.ens = ensStatus;
    } catch (cause) {
      // Not writing a status is the correct outcome of a failed read. Writing
      // "draft" here would record "we looked and found nothing" for "we could
      // not look", which is the precise confusion this script exists to end.
      notes.push(`ENS read failed — ${short(cause)}; ens track left unchanged`);
    }

    // --- ERC 8004 and ENSIP 25 -------------------------------------------
    // Only the research agent has a registered identity today; the other two
    // were never registered, so reporting them "unregistered" is accurate
    // rather than a gap.
    const knownAgentId = agent.slug === "research" ? researchAgentId : undefined;

    if (!erc8004) {
      notes.push(
        "ERC8004_BASE_SEPOLIA_IDENTITY_REGISTRY_ADDRESS unset — erc8004 and ensip25 not synced",
      );
    } else if (!knownAgentId) {
      patch.erc8004 = "unregistered" satisfies Erc8004Provisioning;
      notes.push("no ERC 8004 agent id — unregistered");
    } else {
      try {
        const owner = await erc8004.ownerOf(knownAgentId);
        patch.erc8004 = owner === ZERO ? "unregistered" : "registered";
        notes.push(`ERC 8004 #${knownAgentId} owned by ${owner.slice(0, 10)}…`);

        const result = await verifyEnsip25({
          ensName,
          agentId: knownAgentId,
          registry: identityRegistry!,
          chainId: REGISTRATION_CHAIN_ID,
          erc8004,
          readText: (name, key) => ens.readText(name, key),
        });
        patch.ensip25 = result.status satisfies Ensip25Status;
        notes.push(`ENSIP 25 ${result.status}`);
      } catch (cause) {
        notes.push(
          `ERC 8004 read failed — ${short(cause)}; erc8004 and ensip25 left unchanged`,
        );
      }
    }

    // The agent row must exist before provisioning can be patched. Written
    // unconditionally so a name that failed every read still appears in the
    // console rather than vanishing from it.
    await store.upsertAgent({
      id: agentId,
      organizationId: ORGANIZATION_ID,
      slug: agent.slug,
      ensName,
      controllerAddress: client.controller,
      erc8004AgentId: knownAgentId,
      erc8004Registry: knownAgentId ? identityRegistry : undefined,
    });

    if (Object.keys(patch).length > 0) {
      await store.setProvisioning(agentId, patch);
    }

    findings.push({ slug: agent.slug, ensName, patch, notes });
  }

  for (const finding of findings) {
    console.log(finding.ensName);
    for (const note of finding.notes) console.log(`  ${note}`);
    console.log(
      `  -> ${Object.entries(finding.patch)
        .map(([track, value]) => `${track}=${value}`)
        .join(" ") || "(nothing written)"}\n`,
    );
  }

  console.log(
    "graph and financial were NOT synced — they need GRAPH_API_KEY and the\n" +
      "Privy credentials respectively. Their badges still show the last known\n" +
      "value, which for a fresh store is 'not indexed' and 'no wallet'.",
  );
}

function short(cause: unknown): string {
  const message =
    cause instanceof Error ? cause.message.split("\n")[0] : String(cause);
  return message.length > 70 ? `${message.slice(0, 70)}…` : message;
}

// Not top-level `await`: the root package is CommonJS, so tsx transforms this
// file with esbuild's cjs output format, which rejects it.
main()
  .catch((error: unknown) => {
    console.error(`sync failed: ${short(error)}`);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase().catch(() => {}));
