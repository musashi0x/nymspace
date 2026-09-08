import { serverEnv } from "@nymspace/core/env";
import type { Address, ChainId } from "@nymspace/core";

/**
 * The typed chain configuration docs/19_ENV_AND_CONFIG.md asks for: one module,
 * every changing testnet address read from the environment rather than inlined
 * in application logic.
 */
export interface ChainConfig {
  chainId: ChainId;
  ensv2: {
    rootRegistry?: Address;
    ethRegistry?: Address;
    parentRegistry: Address;
    permissionedResolver: Address;
    universalResolver?: Address;
    verifiableFactory?: Address;
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
      ethRegistry: asAddress(env.ensv2.ethRegistry),
      parentRegistry: requireAddress(
        env.ensv2.parentRegistry,
        "ENSV2_PARENT_REGISTRY_ADDRESS",
      ),
      permissionedResolver: requireAddress(
        env.ensv2.permissionedResolver,
        "ENSV2_PERMISSIONED_RESOLVER_ADDRESS",
      ),
      universalResolver: asAddress(env.ensv2.universalResolver),
      verifiableFactory: asAddress(env.ensv2.verifiableFactory),
    },
    erc8004: {
      identityRegistry: asAddress(env.erc8004.identityRegistry),
    },
    rpcUrl: env.sepoliaRpcUrl,
  };
  return cached;
}
