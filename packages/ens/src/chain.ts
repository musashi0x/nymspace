import { serverEnv } from "@nymspace/core/env";
import type { Address, ChainId } from "@nymspace/core";

/**
 * The typed chain configuration docs/19_ENV_AND_CONFIG.md asks for: one module,
 * every changing testnet address read from the environment rather than inlined
 * in application logic. No address is hardcoded here — `.env.example` carries
 * the canonical Sepolia set and its provenance.
 *
 * The addresses split into two kinds, and the types say which is which:
 *
 *   - Deployed by ENS. Present from the first run; `ethRegistry`,
 *     `verifiableFactory`, and the two implementation addresses the Verifiable
 *     Factory clones.
 *   - Deployed by us. `parentRegistry` and `permissionedResolver` are proxies
 *     the Day 1 spike creates, so they are legitimately absent until it has
 *     run. Product code reads them through {@link requireDeployed}, which fails
 *     at the top of a handler with a message naming the spike rather than
 *     halfway through a transaction.
 */
export interface ChainConfig {
  chainId: ChainId;
  ensv2: {
    rootRegistry?: Address;
    /** The `.eth` registry. Parent of every `.eth` name. */
    ethRegistry: Address;
    /** Commit-reveal registrar for `.eth` names. Prices in an ERC 20. */
    ethRegistrar?: Address;
    verifiableFactory: Address;
    /** Implementation the factory clones for a UserRegistry proxy. */
    userRegistryImpl?: Address;
    /** Implementation the factory clones for a resolver proxy. */
    permissionedResolverImpl?: Address;
    /** ERC 20 the registrar accepts. MockUSDC on Sepolia. */
    paymentToken?: Address;
    universalResolver?: Address;
  };
  /** Everything the spike produces. Absent until it has run. */
  deployed: {
    /** The `.eth` label the organization owns, e.g. `nymspace`. */
    parentLabel?: string;
    /** UserRegistry proxy wired under the parent label. */
    parentRegistry?: Address;
    /** Resolver proxy the organization initialized. */
    permissionedResolver?: Address;
  };
  erc8004: {
    identityRegistry?: Address;
  };
  rpcUrl: string;
}

function asAddress(value: string | undefined): Address | undefined {
  if (value === undefined) return undefined;
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Configured value is not a 20-byte address: ${value}`);
  }
  return value as Address;
}

function requireAddress(value: string, name: string): Address {
  const address = asAddress(value);
  if (!address) throw new Error(`${name} is required`);
  return address;
}

let cached: ChainConfig | undefined;

/** Sepolia by default; the chain id comes from the environment. */
export function chainConfig(): ChainConfig {
  if (cached) return cached;

  const env = serverEnv();
  cached = {
    chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 11155111),
    ensv2: {
      rootRegistry: asAddress(env.ensv2.rootRegistry),
      ethRegistry: requireAddress(
        env.ensv2.ethRegistry,
        "ENSV2_ETH_REGISTRY_ADDRESS",
      ),
      ethRegistrar: asAddress(env.ensv2.ethRegistrar),
      verifiableFactory: requireAddress(
        env.ensv2.verifiableFactory,
        "ENSV2_VERIFIABLE_FACTORY_ADDRESS",
      ),
      userRegistryImpl: asAddress(env.ensv2.userRegistryImpl),
      permissionedResolverImpl: asAddress(env.ensv2.permissionedResolverImpl),
      paymentToken: asAddress(env.ensv2.paymentToken),
      universalResolver: asAddress(env.ensv2.universalResolver),
    },
    deployed: {
      parentLabel: env.ensv2.parentLabel,
      parentRegistry: asAddress(env.ensv2.parentRegistry),
      permissionedResolver: asAddress(env.ensv2.permissionedResolver),
    },
    erc8004: {
      identityRegistry: asAddress(env.erc8004.identityRegistry),
    },
    rpcUrl: env.sepoliaRpcUrl,
  };
  return cached;
}

/** The spike outputs, as a shape with nothing optional. */
export interface DeployedConfig {
  parentLabel: string;
  parentRegistry: Address;
  permissionedResolver: Address;
}

const DEPLOYED_ENV_NAMES: Record<keyof DeployedConfig, string> = {
  parentLabel: "ENSV2_PARENT_LABEL",
  parentRegistry: "ENSV2_PARENT_REGISTRY_ADDRESS",
  permissionedResolver: "ENSV2_PERMISSIONED_RESOLVER_ADDRESS",
};

/**
 * Assert the spike has run and its outputs are configured. Call it at the top
 * of any route that reads or writes agent records; a route that reaches a
 * contract call with a blank resolver address is a route debugging ENSv2 when
 * the actual fault is an unset variable.
 */
export function requireDeployed(config = chainConfig()): DeployedConfig {
  const missing = (
    Object.keys(DEPLOYED_ENV_NAMES) as (keyof DeployedConfig)[]
  ).filter((key) => !config.deployed[key]);

  if (missing.length > 0) {
    throw new Error(
      `ENSv2 namespace is not deployed yet: ${missing
        .map((key) => DEPLOYED_ENV_NAMES[key])
        .join(", ")} unset. Run \`pnpm --filter @nymspace/ens spike\` and copy ` +
        `its recorded addresses into .env.`,
    );
  }

  return config.deployed as DeployedConfig;
}

/** Reset the module cache. Tests only. */
export function resetChainConfig(): void {
  cached = undefined;
}
