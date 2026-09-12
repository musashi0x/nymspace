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

import { privateKeyToAccount } from "viem/accounts";
import { requireServerEnv } from "@nymspace/core/env";
import type { Address, Hex } from "@nymspace/core";
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

/**
 * The names `provision-fleet.ts` creates, kept in step with it by hand.
 *
 * A seed list, not the fleet. A store that already holds agents is the better
 * answer to "which names are there", and the two disagree the moment one is
 * created through the console — production grew a fourth, `stalker`, that way.
 * Syncing only this list would have left exactly the row most likely to be
 * stale untouched, which is the failure this script exists to end.
 *
 * So the list below is the floor: it is what gets synced when the store is
 * empty, and everything the store holds is synced alongside it. See
 * {@link targets}.
 */
const SEED_SLUGS = ["research", "trader", "deploy"] as const;

interface Finding {
  slug: string;
  ensName: string;
  patch: Partial<ProvisioningStatus>;
  notes: string[];
}

/** One name to sync, and what the store already knows about it. */
interface Target {
  slug: string;
  agentId: string;
  /**
   * Undefined for a seed the store has never seen. Every other field follows
   * from this: a row the store holds is the authority on its own controller
   * and registration, and this script must not overwrite either with a
   * configured default it happens to have to hand.
   */
  known?: { controllerAddress: Address; erc8004AgentId?: string };
}

/**
 * Every name worth syncing: what the store holds, plus any seed it does not.
 *
 * Store rows first so a console-created agent keeps its own identity — it was
 * registered by whoever created it, and re-imposing this process's configured
 * controller on it would be this script writing rather than reading.
 */
async function targets(store: Store): Promise<Target[]> {
  const rows = await store.listAgents(ORGANIZATION_ID);
  const found = new Map<string, Target>(
    rows.map((row) => [
      row.slug,
      {
        slug: row.slug,
        agentId: row.id,
        known: {
          controllerAddress: row.controllerAddress,
          ...(row.erc8004AgentId && { erc8004AgentId: row.erc8004AgentId }),
        },
      },
    ]),
  );

  for (const slug of SEED_SLUGS) {
    if (!found.has(slug)) {
      found.set(slug, { slug, agentId: `agent-${slug}` });
    }
  }

  return [...found.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * The two accounts to check permissions for — as addresses, never as signers.
 *
 * Taken from `ENSV2_*_ADDRESS` when set, and otherwise *derived* from the
 * private keys. Both spellings express the same fact, and which one a given
 * environment holds is not this script's business: `.env.example` says the
 * address form is set instead of the keys and ignored when both are present,
 * and `apps/api/src/deps.ts` already treats them as alternatives. Demanding the
 * address form regardless meant this script could not run against the deployed
 * environment at all — Railway holds the keys, which is the correct way to
 * configure a service that signs, and the two address variables are empty
 * there and in `.env.example` because nothing is supposed to set both.
 *
 * Deriving does not weaken the guarantee in this file's header. The key is read
 * here and goes no further: what reaches `createViemChainClient` is an address,
 * so the client it builds has no signer and every write method on it still
 * throws `NoSignerError`. "No keys used — reads only" remains structurally
 * true rather than merely intended.
 */
function readAddresses(): { organization: Address; controller: Address } {
  const organizationKey = process.env["ENSV2_ORGANIZATION_PRIVATE_KEY"] as
    | Hex
    | undefined;
  const controllerKey = process.env["ENSV2_AGENT_CONTROLLER_PRIVATE_KEY"] as
    | Hex
    | undefined;

  if (organizationKey && controllerKey) {
    return {
      organization: privateKeyToAccount(organizationKey).address,
      controller: privateKeyToAccount(controllerKey).address,
    };
  }

  const env = requireServerEnv([
    "ENSV2_ORGANIZATION_ADDRESS",
    "ENSV2_AGENT_CONTROLLER_ADDRESS",
  ] as const);

  return {
    organization: env.ENSV2_ORGANIZATION_ADDRESS as Address,
    controller: env.ENSV2_AGENT_CONTROLLER_ADDRESS as Address,
  };
}

async function main(): Promise<void> {
  const config = chainConfig();
  const deployed = requireDeployed(config);
  const readers = readAddresses();

  // Addresses, not keys. Every write method on this client throws
  // `NoSignerError`, which is the guarantee that this script cannot provision
  // by accident.
  const client = createViemChainClient({
    rpcUrl: config.rpcUrl,
    chainId: config.chainId,
    organizationAddress: readers.organization,
    controllerAddress: readers.controller,
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
        organizationAddress: readers.organization,
        controllerAddress: readers.controller,
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

  const db = database();
  await migrate(db);
  const store = new Store(db);

  await store.upsertOrganization({
    id: ORGANIZATION_ID,
    displayName: "Nymspace",
    parentEnsName: parentName,
    chainId: config.chainId,
  });

  // After the store is open, because which names to sync is partly its answer.
  const fleet = await targets(store);
  const fresh = fleet.filter((target) => !target.known).length;

  console.log(`syncing ${fleet.length} agents under ${parentName}`);
  console.log(`  resolver  ${deployed.permissionedResolver}`);
  console.log(`  registry  ${deployed.parentRegistry}`);
  console.log(
    `  ${fleet.length - fresh} already in the store, ${fresh} seeded from this script`,
  );
  console.log(`  no keys used — reads only\n`);

  const findings: Finding[] = [];

  for (const agent of fleet) {
    const ensName = `${agent.slug}.${parentName}`;
    const agentId = agent.agentId;
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
    /**
     * The store's own id first, the configured one only as a seed.
     *
     * `ERC8004_RESEARCH_AGENT_ID` names one agent, which was fine while the
     * fleet was the three this script created and only `research` had ever
     * been registered. An agent created through the console registers its own
     * identity and the store is the only place that id exists — reading it
     * from the row is what lets this script verify ENSIP 25 for a name it did
     * not create, rather than reporting it unregistered because it had nowhere
     * to look.
     */
    const knownAgentId =
      agent.known?.erc8004AgentId ??
      (agent.slug === "research" ? researchAgentId : undefined);

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
      /**
       * A stored controller is left alone.
       *
       * `client.controller` is this process's configured address, which is the
       * right seed for a name this script is creating a row for and the wrong
       * thing to write over a name someone else registered under a controller
       * of their own. This field is not coalesced by `upsertAgent` — it is
       * written on conflict — so passing the configured value unconditionally
       * would silently reassign authority on every run.
       */
      controllerAddress: agent.known?.controllerAddress ?? client.controller,
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
