import { concat, keccak256, namehash, toBytes, toHex } from "viem";
import type { Address, Hex } from "@nymspace/core";

/**
 * ENSv2 Enhanced Access Control: role bitmaps, resource derivation, and the
 * permission predicate the UI answers with.
 *
 * Everything here is transcribed from the deployed contracts rather than from
 * `docs/05_ENSV2_IMPLEMENTATION.md`, which treats registry and resolver
 * permissions as one concept. They are two EAC domains on two contracts with
 * two role vocabularies and no bridge between them: registry ownership confers
 * no resolver authority whatsoever.
 *
 * Sources, at ensdomains/contracts-v2 @ 97a57293f3:
 *   contracts/src/registry/libraries/RegistryRolesLib.sol
 *   contracts/src/resolver/libraries/PermissionedResolverLib.sol
 *   contracts/src/access-control/libraries/EACBaseRolesLib.sol
 *   contracts/src/access-control/EnhancedAccessControl.sol
 */

/** The resource every root-scoped grant is held on. `resource(0, 0)` is 0. */
export const ROOT_RESOURCE = 0n;

const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;

/**
 * Bit 0 of every nybble, across all 64 slots (32 regular + 32 admin). This is
 * the bitmap that grants everything, and the value the resolver proxy is
 * initialized with so the organization can both delegate and write.
 */
export const ALL_ROLES =
  0x1111111111111111111111111111111111111111111111111111111111111111n;

/** The 32 admin nybbles alone, upper 128 bits. */
export const ADMIN_ROLES =
  0x1111111111111111111111111111111100000000000000000000000000000000n;

/**
 * The admin counterpart of a role, at `role << 128`.
 *
 * An admin role confers grant and revoke authority and nothing else —
 * `withAdminRolesApplied` appears only in `_getSettableRoles` and
 * `_getRevokableRoles`, never in the enforcement path. So `ROLE_SET_TEXT_ADMIN`
 * does not permit `setText`, and `ROLE_REGISTRAR_ADMIN` does not permit
 * `register`. A bitmap that wants both must carry both.
 */
export function adminOf(role: bigint): bigint {
  return role << 128n;
}

/** Roles on `PermissionedRegistry` — the `.eth` registry and every UserRegistry. */
export const REGISTRY_ROLE = {
  /** Register and reserve names. Root only. */
  REGISTRAR: 1n << 0n,
  /** Promote a reserved name to registered. Root only. */
  REGISTER_RESERVED: 1n << 4n,
  /** Set the parent registry. Root only. */
  SET_PARENT: 1n << 8n,
  /** Unregister names. Root or token. */
  UNREGISTER: 1n << 12n,
  /** Extend expiry. Root or token. */
  RENEW: 1n << 16n,
  /** Change a name's child registry. Root or token. */
  SET_SUBREGISTRY: 1n << 20n,
  /** Change a name's resolver. Root or token. */
  SET_RESOLVER: 1n << 24n,
  /** Set the token URI. Root only. */
  SET_URI: 1n << 36n,
} as const;

/** Roles on `PermissionedResolver`. Note `SET_TEXT` is `1 << 4`, not `1 << 3`. */
export const RESOLVER_ROLE = {
  SET_ADDR: 1n << 0n,
  SET_TEXT: 1n << 4n,
  SET_CONTENTHASH: 1n << 8n,
  SET_PUBKEY: 1n << 12n,
  SET_ABI: 1n << 16n,
  SET_INTERFACE: 1n << 20n,
  SET_NAME: 1n << 24n,
  SET_ALIAS: 1n << 28n,
  CLEAR: 1n << 32n,
  SET_DATA: 1n << 36n,
} as const;

export type RegistryRole = (typeof REGISTRY_ROLE)[keyof typeof REGISTRY_ROLE];
export type ResolverRole = (typeof RESOLVER_ROLE)[keyof typeof RESOLVER_ROLE];
export type Role = RegistryRole | ResolverRole;

/** Combine roles into the single bitmap the contracts take. */
export function roleBitmap(...roles: bigint[]): bigint {
  return roles.reduce((bitmap, role) => bitmap | role, 0n);
}

/** True when `bitmap` carries every role in `roles`. */
export function bitmapHasRoles(bitmap: bigint, ...roles: bigint[]): boolean {
  const wanted = roleBitmap(...roles);
  return (bitmap & wanted) === wanted;
}

/**
 * The role bitmap a fresh UserRegistry proxy is initialized with.
 *
 * This value is effectively one-shot: `grantRootRoles` requires the caller to
 * already hold the role's admin counterpart, so a role omitted here can never
 * be added and the proxy has to be redeployed. Each bit is here for a reason:
 *
 *   REGISTRAR              register() agent subnames directly, no registrar
 *                          contract and no payment token. `_register` checks
 *                          this on ROOT_RESOURCE.
 *   REGISTRAR_ADMIN        grant REGISTRAR to a future registrar contract
 *                          without redeploying.
 *   RENEW + RENEW_ADMIN    extend a subname's expiry, and delegate that.
 *   SET_SUBREGISTRY (+admin)
 *   SET_RESOLVER (+admin)  the reclaim authority D7 keeps deliberately: the
 *                          organization can repoint or reclaim a compromised
 *                          agent's identity. The registry stays unemancipated
 *                          on purpose, and the demo says so.
 *   UNREGISTER (+admin)    same reason.
 *
 * Deliberately absent: SET_PARENT (the parent is the `.eth` registry and never
 * changes) and SET_URI (nothing reads the token URI).
 */
export const USER_REGISTRY_INIT_ROLES = roleBitmap(
  REGISTRY_ROLE.REGISTRAR,
  adminOf(REGISTRY_ROLE.REGISTRAR),
  REGISTRY_ROLE.RENEW,
  adminOf(REGISTRY_ROLE.RENEW),
  REGISTRY_ROLE.SET_SUBREGISTRY,
  adminOf(REGISTRY_ROLE.SET_SUBREGISTRY),
  REGISTRY_ROLE.SET_RESOLVER,
  adminOf(REGISTRY_ROLE.SET_RESOLVER),
  REGISTRY_ROLE.UNREGISTER,
  adminOf(REGISTRY_ROLE.UNREGISTER),
);

/**
 * The role bitmap an agent subname's owner receives at `register()`.
 *
 * These are registry-domain roles on the subname's own resource, and they
 * touch nothing on the resolver. The agent controller is granted none of them,
 * which is exactly what makes the `setResolver` denial hold by construction
 * rather than by an application check.
 */
export const AGENT_SUBNAME_OWNER_ROLES = roleBitmap(
  REGISTRY_ROLE.SET_RESOLVER,
  REGISTRY_ROLE.SET_SUBREGISTRY,
  REGISTRY_ROLE.RENEW,
);

/**
 * `PermissionedResolverLib.resource(node, part)` — `keccak256` over the two
 * words laid out adjacently, with `(0, 0)` short-circuiting to `ROOT_RESOURCE`.
 *
 * For two `bytes32` values `abi.encode` and `abi.encodePacked` are identical,
 * so plain concatenation is correct. The zero case matters: without it,
 * `resource(0, 0)` would hash to a non-zero value and every root-scoped read
 * would silently miss.
 */
export function resource(node: Hex, part: Hex): bigint {
  if (node === ZERO_BYTES32 && part === ZERO_BYTES32) return ROOT_RESOURCE;
  return BigInt(keccak256(concat([node, part])));
}

/** `PermissionedResolverLib.partHash(string)` — the record-type id for a text key. */
export function textPart(key: string): Hex {
  return keccak256(toBytes(key));
}

/** `PermissionedResolverLib.partHash(uint256)` — the record-type id for a coin type. */
export function addrPart(coinType: bigint): Hex {
  return keccak256(toHex(coinType, { size: 32 }));
}

/** The name-scoped resource, `resource(node, 0)`. Grant authority lives here. */
export function nameResource(name: string): bigint {
  return resource(namehash(name) as Hex, ZERO_BYTES32);
}

/** The record-scoped resource for one text key under one name. */
export function textRecordResource(name: string, key: string): bigint {
  return resource(namehash(name) as Hex, textPart(key));
}

/**
 * The wildcard resource, `resource(0, part)` — "this key on every name in this
 * resolver".
 *
 * Exported so the spike can assert it is empty, and for no other reason. One
 * shared resolver serves every agent, so a single wildcard grant would let one
 * agent's controller rewrite that key for all of them. Never construct this in
 * a grant path.
 */
export function wildcardTextResource(key: string): bigint {
  return resource(ZERO_BYTES32, textPart(key));
}

/** The two scopes a resolver role can be held over. */
export type EacResource =
  | { scope: "name"; name: string }
  | { scope: "record"; name: string; key: string };

export function nameScope(name: string): EacResource {
  return { scope: "name", name };
}

export function recordScope(name: string, key: string): EacResource {
  return { scope: "record", name, key };
}

/**
 * Turns a resource into the `uint256` the resolver's role checks take.
 *
 * Still a port so tests can substitute one, but no longer a hole: the
 * derivation is settled against `PermissionedResolverLib` and
 * {@link deriveResource} is the default everywhere.
 */
export type ResourceDeriver = (resource: EacResource) => bigint;

export const deriveResource: ResourceDeriver = (target) =>
  target.scope === "name"
    ? nameResource(target.name)
    : textRecordResource(target.name, target.key);

/**
 * The alternatives `setText` accepts, in the order the contract checks them.
 *
 * `onlyPartRoles` passes when the caller holds the role on the record
 * resource, OR on the wildcard resource, OR on the name resource. A predicate
 * that checks only the first would render a name-level grant as "denied" while
 * the transaction succeeds — a UI that lies in the safe-looking direction,
 * which is worse than one that lies loudly.
 */
export function setTextResourceAlternatives(
  name: string,
  key: string,
): bigint[] {
  return [
    textRecordResource(name, key),
    wildcardTextResource(key),
    nameResource(name),
  ];
}

/** A permission question, asked of one controller over one resource. */
export interface PermissionQuery {
  resource: EacResource;
  controller: Address;
  roles: bigint[];
}
