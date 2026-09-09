/**
 * What does chain actually say about the fleet?
 *
 * Run: pnpm --filter @nymspace/ens read:fleet
 *
 * Every other fleet script needs both private keys, because every other fleet
 * script writes. Gate A spends gas by design — it proves a denial by being
 * denied. That is correct for a gate and useless for the question asked most
 * often, which is simply *what is out there right now*.
 *
 * This reads and nothing else, so it runs with no key material at all: the
 * addresses are enough. That is the read/write split from
 * `openspec/changes/organization-wallet-signing/` applied to the scripts, and
 * it means someone holding no keys can still see the fleet.
 *
 * More to the point, it tells a stale store from an unprovisioned name. The
 * console renders `agent_provisioning`, which records how far *our pipeline*
 * got. When that says `ens: draft` there are two very different explanations —
 * the name was never registered, or it was registered by a run whose store we
 * do not have — and they are indistinguishable from the console alone. Chain
 * settles it, and the answer decides whether the fix is "provision" or
 * "restore the database".
 */

import { requireServerEnv } from "@nymspace/core/env";
import type { Address } from "@nymspace/core";
import {
  AGENT_CONTEXT_KEY,
  EnsService,
  agentEndpointKey,
  chainConfig,
  createViemChainClient,
  requireDeployed,
} from "../src/index";

/** The fleet `provision-fleet.ts` creates. Kept in step with it by hand. */
const SLUGS = ["research", "trader", "deploy"] as const;

const KEYS = [
  AGENT_CONTEXT_KEY,
  agentEndpointKey("mcp"),
  agentEndpointKey("a2a"),
] as const;

function truncate(value: string, at = 68): string {
  return value.length > at ? `${value.slice(0, at)}…` : value;
}

async function main() {
  const env = requireServerEnv([
    "SEPOLIA_RPC_URL",
    "ENSV2_PARENT_LABEL",
    "ENSV2_ORGANIZATION_ADDRESS",
    "ENSV2_AGENT_CONTROLLER_ADDRESS",
  ] as const);

  const deployed = requireDeployed();

  // Addresses, not keys. `createViemChainClient` accepts either; every write
  // method on the resulting client throws `NoSignerError`, which is the point.
  const client = createViemChainClient({
    rpcUrl: env.SEPOLIA_RPC_URL,
    chainId: chainConfig().chainId,
    organizationAddress: env.ENSV2_ORGANIZATION_ADDRESS as Address,
    controllerAddress: env.ENSV2_AGENT_CONTROLLER_ADDRESS as Address,
  });
  const ens = new EnsService({ client });

  const parent = `${env.ENSV2_PARENT_LABEL}.eth`;
  console.log(`resolver  ${deployed.permissionedResolver}`);
  console.log(`registry  ${deployed.parentRegistry}`);
  console.log(`parent    ${parent}`);
  console.log(`no keys used — reads only\n`);

  let found = 0;
  let failed = 0;

  for (const slug of SLUGS) {
    const ensName = `${slug}.${parent}`;
    console.log(ensName);

    for (const key of KEYS) {
      try {
        const value = await ens.readText(ensName, key);
        if (value) found += 1;
        console.log(`  ${key.padEnd(22)} ${value ? truncate(value) : "(empty)"}`);
      } catch (cause) {
        // A read that fails is not a record that is absent. Collapsing the two
        // is how "no data" gets displayed for "we could not look".
        failed += 1;
        const message =
          cause instanceof Error ? cause.message.split("\n")[0] : String(cause);
        console.log(`  ${key.padEnd(22)} READ FAILED — ${truncate(message, 56)}`);
      }
    }
    console.log();
  }

  console.log(`${found} record(s) present, ${failed} read(s) failed.`);

  if (found === 0 && failed === 0) {
    console.log(
      "\nNothing is provisioned on this deployment, so an empty console is\n" +
        "accurate rather than stale. Provisioning needs\n" +
        "ENSV2_ORGANIZATION_PRIVATE_KEY and ENSV2_AGENT_CONTROLLER_PRIVATE_KEY.",
    );
  } else if (found > 0) {
    console.log(
      "\nChain holds records the local store does not. The store is behind,\n" +
        "not the chain — restore it or re-run provisioning rather than\n" +
        "reading the console's grey badges as the truth.",
    );
  }
}

await main();
