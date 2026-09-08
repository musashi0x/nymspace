import { encodeAbiParameters, keccak256, toBytes } from "viem";
import type { Address, Hex } from "@nymspace/core";

/**
 * Salts for the Verifiable Factory, and why they are not arbitrary.
 *
 * `deployProxy(implementation, salt, initData)` places the proxy at a CREATE2
 * address derived from `(creation code, factory, salt)`. A random salt works
 * once and then loses the address forever: a re-run deploys a second resolver,
 * the first one keeps the grants, and the two disagree about who may write
 * what. ENS publishes a convention for exactly this reason, one proxy per
 * (kind, owner, version):
 *
 *   PermissionedResolverImpl  keccak256("OwnedResolver", owner, version)
 *   UserRegistryImpl          keccak256("UserRegistry", namehash, version)
 *
 * Following it means the address is known before the transaction is sent, a
 * re-run is a no-op rather than a fork, and bumping `version` is the deliberate
 * way to replace a proxy whose initialization was wrong — which matters,
 * because the UserRegistry role bitmap is one-shot.
 */

/** `keccak256(abi.encode(keccak256(kind), subject, version))`. */
function factorySalt(kind: string, subject: Hex, version: bigint): bigint {
  return BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }],
        [keccak256(toBytes(kind)), subject, version],
      ),
    ),
  );
}

function addressAsWord(address: Address): Hex {
  return `0x${address.toLowerCase().slice(2).padStart(64, "0")}` as Hex;
}

/** One resolver proxy per owner. Bump `version` to replace it. */
export function resolverSalt(owner: Address, version = 0n): bigint {
  return factorySalt("OwnedResolver", addressAsWord(owner), version);
}

/** One subname registry per name. Bump `version` to replace it. */
export function userRegistrySalt(namehash: Hex, version = 0n): bigint {
  return factorySalt("UserRegistry", namehash, version);
}
