/**
 * Regenerate `packages/ens/src/abis.ts` from the canonical ENSv2 deployment
 * artifacts.
 *
 * Why a generator rather than hand-transcribed fragments: the fragments the
 * scaffold left were written from `docs/05_ENSV2_IMPLEMENTATION.md` and three
 * of them were wrong against the deployed contracts — `hasRoles` takes a
 * `uint256` resource rather than `bytes32`, `getSubregistry` takes a label
 * string rather than a labelhash, and `register` returns a token id. ENSv2 is
 * in beta (docs/17_RISKS_AND_FALLBACKS.md Risk 1), so the fragments will move
 * again. Bump `COMMIT` and re-run instead of editing by hand.
 *
 * Source of truth: `ensdomains/contracts-v2`, at the same commit the ENS
 * documentation's own Deployments page pins
 * (`ensdomains/docs` `scripts/ensv2-deployments.ts`, `CONTRACTS_V2_COMMIT`).
 * `ensdomains/namechain` also carries Sepolia deployment sets; they are a
 * different, older deployment and every address in them differs. See the
 * provenance block this script emits into the generated file.
 *
 * Run: pnpm --filter @nymspace/ens generate:abis
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/** The commit `ensdomains/docs` pins for its ENSv2 Deployments page. */
const COMMIT = "97a57293f3b4279d94b571e678edb53ce62638f4";

const ARTIFACTS = `https://raw.githubusercontent.com/ensdomains/contracts-v2/${COMMIT}/contracts/deployments/sepolia`;
const ADDRESSES_MD = `https://raw.githubusercontent.com/ensdomains/contracts-v2/${COMMIT}/contracts/docs/addresses/sepolia.md`;

/**
 * The fragments the product calls, per contract. Everything else is dropped:
 * a pinned ABI is a contract with our own call sites, and an unused fragment
 * is a shape nothing verifies.
 */
const WANTED: Record<string, { exportName: string; members: string[] }> = {
  UserRegistryImpl: {
    exportName: "registryAbi",
    members: [
      "ROOT_RESOURCE",
      "findOwner",
      "findTokenId",
      "getExpiry",
      "getResolver",
      "getResource",
      "getSubregistry",
      "getTokenId",
      "grantRootRoles",
      "hasRoles",
      "hasRootRoles",
      "ownerOf",
      "register",
      "renew",
      "revokeRoles",
      "roles",
      "setResolver",
      "setSubregistry",
      "unregister",
      "initialize",
      "EACRolesChanged",
      "LabelRegistered",
      "ResolverUpdated",
      "SubregistryUpdated",
    ],
  },
  PermissionedResolverImpl: {
    exportName: "permissionedResolverAbi",
    members: [
      "ROOT_RESOURCE",
      "authorizeNameRoles",
      "authorizeTextRoles",
      "hasRoles",
      "hasRootRoles",
      "initialize",
      "roles",
      "setText",
      "text",
      "EACRolesChanged",
      "NamedTextResource",
      "TextChanged",
    ],
  },
  VerifiableFactory: {
    exportName: "verifiableFactoryAbi",
    members: ["deployProxy", "ProxyDeployed"],
  },
  ETHRegistrar: {
    exportName: "ethRegistrarAbi",
    members: [
      "MAX_COMMITMENT_AGE",
      "MIN_COMMITMENT_AGE",
      "MIN_REGISTER_DURATION",
      "commit",
      "getRegisterPrice",
      "isAvailable",
      "makeCommitment",
      "register",
      "CommitmentMade",
      "NameRegistered",
    ],
  },
  MockUSDC: {
    exportName: "erc20Abi",
    members: ["allowance", "approve", "balanceOf", "decimals", "mint", "symbol"],
  },
};

/**
 * The `.eth` registry runs the same `PermissionedRegistry` interface as every
 * UserRegistry proxy, minus `initialize` — it is deployed directly rather than
 * behind the Verifiable Factory. One ABI therefore covers both, and this script
 * asserts the two artifacts agree rather than assuming it.
 */
const REGISTRY_TWIN = "ETHRegistry";
const PROXY_ONLY = ["initialize"];

interface AbiItem {
  type: string;
  name?: string;
  inputs?: unknown[];
  outputs?: unknown[];
  stateMutability?: string;
  anonymous?: boolean;
}

interface Artifact {
  address: string;
  abi: AbiItem[];
}

async function artifact(name: string): Promise<Artifact> {
  const response = await fetch(`${ARTIFACTS}/${name}.json`);
  if (!response.ok) {
    throw new Error(`${name}.json: HTTP ${response.status} from contracts-v2`);
  }
  return (await response.json()) as Artifact;
}

function signature(item: AbiItem): string {
  const inputs = (item.inputs ?? []) as { type: string }[];
  return `${item.name}(${inputs.map((input) => input.type).join(",")})`;
}

function select(abi: AbiItem[], members: string[], context: string): AbiItem[] {
  const wanted = new Set(members);
  const picked = abi.filter(
    (item) => item.name !== undefined && wanted.has(item.name),
  );

  const found = new Set(picked.map((item) => item.name));
  const missing = members.filter((member) => !found.has(member));
  if (missing.length > 0) {
    throw new Error(`${context}: no such fragment: ${missing.join(", ")}`);
  }

  return picked.sort((a, b) => signature(a).localeCompare(signature(b)));
}

/** Parse `| Name | [0x…](explorer) |` rows out of the addresses markdown. */
async function canonicalAddresses(): Promise<Map<string, string>> {
  const response = await fetch(ADDRESSES_MD);
  if (!response.ok) {
    throw new Error(`addresses/sepolia.md: HTTP ${response.status}`);
  }
  const source = await response.text();
  const rows = new Map<string, string>();
  const entry = /^\|\s*([A-Za-z0-9]+)\s*\|\s*\[(0x[0-9a-fA-F]{40})\]/gm;
  for (const match of source.matchAll(entry)) rows.set(match[1], match[2]);
  return rows;
}

async function main() {
  const addresses = await canonicalAddresses();

  const sections: string[] = [];
  const provenance: string[] = [];

  const twin = await artifact(REGISTRY_TWIN);

  for (const [contract, { exportName, members }] of Object.entries(WANTED)) {
    const deployed = await artifact(contract);
    const fragments = select(deployed.abi, members, contract);

    if (contract === "UserRegistryImpl") {
      // Prove the two registries share an interface rather than assuming it:
      // a divergence means one pinned ABI can no longer serve both, and the
      // export must split before any call site is written against it.
      const shared = members.filter((member) => !PROXY_ONLY.includes(member));
      const mine = JSON.stringify(
        fragments.filter((item) => !PROXY_ONLY.includes(item.name ?? "")),
      );
      const theirs = JSON.stringify(select(twin.abi, shared, REGISTRY_TWIN));
      if (mine !== theirs) {
        throw new Error(
          `${REGISTRY_TWIN} and UserRegistryImpl disagree on the shared registry ` +
            `ABI; they can no longer share one pinned export`,
        );
      }
    }

    provenance.push(
      ` * ${contract.padEnd(26)} ${addresses.get(contract) ?? "(not in addresses/sepolia.md)"}`,
    );
    sections.push(
      `export const ${exportName} = ${JSON.stringify(fragments, null, 2)} as const;`,
    );
  }

  provenance.push(
    ` * ${REGISTRY_TWIN.padEnd(26)} ${addresses.get(REGISTRY_TWIN) ?? "(not in addresses/sepolia.md)"}`,
  );

  const header = `/**
 * Pinned ABI fragments for the ENSv2 contracts this product touches.
 *
 * GENERATED FILE — do not edit. Regenerate with:
 *   pnpm --filter @nymspace/ens generate:abis
 *
 * Source: ensdomains/contracts-v2 @ ${COMMIT}
 *         contracts/deployments/sepolia/<Contract>.json
 * That commit is the one ensdomains/docs pins for the ENSv2 Deployments page,
 * which docs/20_SOURCES.md treats as authoritative. \`ensdomains/namechain\`
 * carries older Sepolia sets whose addresses all differ; they are not used.
 *
 * Deployed addresses at this commit, for cross-checking .env against the
 * canonical set. Nothing in source reads them — every address the product uses
 * comes from the environment, per the spike's configuration requirement.
 *
${provenance.join("\n")}
 *
 * Only the fragments the product calls are pinned. Adding a call site means
 * adding its fragment to \`WANTED\` in scripts/generate-abis.ts and
 * regenerating, so an unverified shape can never reach a transaction.
 */
`;

  const out = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "src",
    "abis.ts",
  );
  writeFileSync(out, `${header}\n${sections.join("\n\n")}\n`);
  console.log(`Wrote ${out}`);

  console.log("\nCanonical Sepolia addresses (for .env.example):");
  for (const [name, address] of addresses) console.log(`  ${name.padEnd(32)} ${address}`);
}

await main();
