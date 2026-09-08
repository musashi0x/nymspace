import type { Address, Hex } from "@nymspace/core";

/**
 * ENSv2 Enhanced Access Control: resource derivation and role bitmaps.
 *
 * A resource is the thing a role is held over — a name, or one record key
 * under a name. docs/05_ENSV2_IMPLEMENTATION.md step 1 of "Permission reads
 * for UI" says to compute the record resource "through the current contract
 * helper path", because the derivation is not stable across the beta.
 *
 * So this module models the resource as a discriminated union and defers the
 * hashing to a `ResourceDeriver` supplied at construction. The Day 1 spike
 * reads the deployed helper and provides the real implementation; nothing
 * downstream changes when it does.
 */

/** A role bitmap position, as used by `hasRoles` and `register`. */
export const ROLE = {
  SET_RESOLVER: 1n << 0n,
  SET_SUBREGISTRY: 1n << 1n,
  UNREGISTER: 1n << 2n,
  SET_TEXT: 1n << 3n,
} as const;

export type Role = (typeof ROLE)[keyof typeof ROLE];

/** Combine roles into the single bitmap the contracts take. */
export function roleBitmap(...roles: Role[]): bigint {
  return roles.reduce((bitmap, role) => bitmap | role, 0n);
}

/** True when `bitmap` carries every role in `roles`. */
export function hasRoles(bitmap: bigint, ...roles: Role[]): boolean {
  const wanted = roleBitmap(...roles);
  return (bitmap & wanted) === wanted;
}

/** The two scopes a role can be held over. */
export type EacResource =
  | { scope: "name"; name: string }
  | { scope: "record"; name: string; key: string };

export function nameResource(name: string): EacResource {
  return { scope: "name", name };
}

export function recordResource(name: string, key: string): EacResource {
  return { scope: "record", name, key };
}

/**
 * Turns a resource into the `bytes32` the resolver's role checks take.
 *
 * Deliberately injected rather than implemented: the derivation lives in the
 * deployed contract helper and the beta may move it. Implementing a guess here
 * would produce role checks that return false for reasons no log explains.
 */
export type ResourceDeriver = (resource: EacResource) => Promise<Hex>;

/** A permission question, asked of one controller over one resource. */
export interface PermissionQuery {
  resource: EacResource;
  controller: Address;
  roles: Role[];
}
