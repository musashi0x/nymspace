import { describe, expect, it } from "vitest";
import { keccak256, namehash, toBytes } from "viem";
import { resolverSalt, userRegistrySalt } from "./factory";
import {
  ADMIN_ROLES,
  ALL_ROLES,
  AGENT_SUBNAME_OWNER_ROLES,
  REGISTRY_ROLE,
  RESOLVER_ROLE,
  ROOT_RESOURCE,
  USER_REGISTRY_INIT_ROLES,
  addrPart,
  adminOf,
  bitmapHasRoles,
  deriveResource,
  nameResource,
  nameScope,
  recordScope,
  resource,
  roleBitmap,
  setTextResourceAlternatives,
  textPart,
  textRecordResource,
  wildcardTextResource,
} from "./eac";

const NAME = "research.nymspace.eth";
const KEY = "agent-endpoint[mcp]";
const ZERO = `0x${"0".repeat(64)}` as const;

describe("role constants", () => {
  // Transcribed from RegistryRolesLib.sol and PermissionedResolverLib.sol.
  // Each role occupies a nybble, so the shifts step by four, not by one. The
  // scaffold had SET_TEXT at 1 << 3, which is inside SET_ADDR's nybble.
  it("places resolver roles on nybble boundaries", () => {
    expect(RESOLVER_ROLE.SET_ADDR).toBe(1n);
    expect(RESOLVER_ROLE.SET_TEXT).toBe(16n);
    expect(RESOLVER_ROLE.SET_CONTENTHASH).toBe(256n);
  });

  it("places registry roles on nybble boundaries", () => {
    expect(REGISTRY_ROLE.REGISTRAR).toBe(1n);
    expect(REGISTRY_ROLE.RENEW).toBe(1n << 16n);
    expect(REGISTRY_ROLE.SET_RESOLVER).toBe(1n << 24n);
  });

  it("puts an admin counterpart 128 bits above its role", () => {
    expect(adminOf(RESOLVER_ROLE.SET_TEXT)).toBe(RESOLVER_ROLE.SET_TEXT << 128n);
    expect(adminOf(RESOLVER_ROLE.SET_TEXT) & ADMIN_ROLES).toBe(
      adminOf(RESOLVER_ROLE.SET_TEXT),
    );
  });

  it("keeps every role inside the ALL_ROLES mask", () => {
    for (const role of [
      ...Object.values(REGISTRY_ROLE),
      ...Object.values(RESOLVER_ROLE),
    ]) {
      expect(role & ALL_ROLES).toBe(role);
      expect(adminOf(role) & ALL_ROLES).toBe(adminOf(role));
    }
  });
});

describe("bitmaps", () => {
  it("requires every named role, not any of them", () => {
    const held = roleBitmap(RESOLVER_ROLE.SET_TEXT, RESOLVER_ROLE.SET_ADDR);
    expect(bitmapHasRoles(held, RESOLVER_ROLE.SET_TEXT)).toBe(true);
    expect(
      bitmapHasRoles(held, RESOLVER_ROLE.SET_TEXT, RESOLVER_ROLE.SET_ADDR),
    ).toBe(true);
    expect(
      bitmapHasRoles(held, RESOLVER_ROLE.SET_TEXT, RESOLVER_ROLE.CLEAR),
    ).toBe(false);
  });

  /**
   * `initialize()` on a UserRegistry proxy is effectively one-shot: granting a
   * role later needs its admin counterpart, which must therefore already be in
   * this bitmap. Omitting one costs a redeploy, so these are asserted rather
   * than reviewed by eye.
   */
  it("carries both halves of every registry role it grants at initialize", () => {
    for (const role of [
      REGISTRY_ROLE.REGISTRAR,
      REGISTRY_ROLE.RENEW,
      REGISTRY_ROLE.SET_SUBREGISTRY,
      REGISTRY_ROLE.SET_RESOLVER,
      REGISTRY_ROLE.UNREGISTER,
    ]) {
      expect(bitmapHasRoles(USER_REGISTRY_INIT_ROLES, role)).toBe(true);
      expect(bitmapHasRoles(USER_REGISTRY_INIT_ROLES, adminOf(role))).toBe(true);
    }
  });

  /**
   * An admin role confers grant and revoke authority and nothing else, so a
   * bitmap of admin bits alone would let the organization delegate a key it
   * could never write itself.
   */
  it("does not mistake an admin role for the action", () => {
    const adminOnly = adminOf(REGISTRY_ROLE.REGISTRAR);
    expect(bitmapHasRoles(adminOnly, REGISTRY_ROLE.REGISTRAR)).toBe(false);
  });

  /** The controller's denial in the registry domain holds by construction. */
  it("grants the subname owner no registrar authority", () => {
    expect(
      bitmapHasRoles(AGENT_SUBNAME_OWNER_ROLES, REGISTRY_ROLE.REGISTRAR),
    ).toBe(false);
  });
});

describe("resource derivation", () => {
  /**
   * `PermissionedResolverLib.resource` short-circuits `(0, 0)` to zero. Without
   * that case the root resource would hash to something non-zero and every
   * root-scoped read would silently miss — a wrong answer that reads exactly
   * like a denial.
   */
  it("returns ROOT_RESOURCE for the zero pair", () => {
    expect(resource(ZERO, ZERO)).toBe(ROOT_RESOURCE);
    expect(ROOT_RESOURCE).toBe(0n);
  });

  it("hashes node and part as two adjacent words", () => {
    const node = namehash(NAME) as `0x${string}`;
    const part = textPart(KEY);
    expect(part).toBe(keccak256(toBytes(KEY)));
    expect(resource(node, part)).toBe(
      2833852848768802904587816021781661066350120246780760126500012379383229700931n,
    );
  });

  it("keeps the three scopes distinct", () => {
    expect(nameResource(NAME)).toBe(
      71678760582233053864232651433844026006748633398775695081126162134288844115272n,
    );
    expect(wildcardTextResource(KEY)).toBe(
      64459804688331649330298694015745334211162807658675287983634473968953370066172n,
    );
    expect(textRecordResource(NAME, KEY)).not.toBe(nameResource(NAME));
    expect(textRecordResource(NAME, KEY)).not.toBe(wildcardTextResource(KEY));
  });

  it("is order-sensitive, so node and part cannot be swapped silently", () => {
    const node = namehash(NAME) as `0x${string}`;
    const part = textPart(KEY);
    expect(resource(node, part)).not.toBe(resource(part, node));
  });

  it("hashes a coin type as a 32-byte word", () => {
    expect(addrPart(60n)).toBe(
      "0xc6bb06cb7f92603de181bf256cd16846b93b752a170ff24824098b31aa008a7e",
    );
  });

  it("routes both scopes through the implemented deriver", () => {
    expect(deriveResource(nameScope(NAME))).toBe(nameResource(NAME));
    expect(deriveResource(recordScope(NAME, KEY))).toBe(
      textRecordResource(NAME, KEY),
    );
  });
});

describe("the setText permission predicate", () => {
  /**
   * `onlyPartRoles` passes on the record resource, OR the wildcard, OR the
   * name resource. A predicate checking only the first would render a
   * name-level grant as "denied" while the transaction succeeds.
   */
  it("offers the same three alternatives the contract accepts, in order", () => {
    expect(setTextResourceAlternatives(NAME, KEY)).toEqual([
      textRecordResource(NAME, KEY),
      wildcardTextResource(KEY),
      nameResource(NAME),
    ]);
  });

  it("distinguishes two keys under the same name", () => {
    expect(textRecordResource(NAME, KEY)).not.toBe(
      textRecordResource(NAME, "agent-context"),
    );
  });

  it("distinguishes the same key under two names", () => {
    expect(textRecordResource(NAME, KEY)).not.toBe(
      textRecordResource("payments.nymspace.eth", KEY),
    );
  });
});

describe("factory salts", () => {
  const OWNER = "0x1111111111111111111111111111111111111111" as const;
  const OTHER = "0x2222222222222222222222222222222222222222" as const;

  /**
   * A random salt deploys a second proxy on every re-run, and the first one
   * keeps the grants. Determinism is what makes a re-run a no-op instead of a
   * fork.
   */
  it("is stable for the same owner", () => {
    expect(resolverSalt(OWNER)).toBe(resolverSalt(OWNER));
    expect(userRegistrySalt(namehash(NAME) as `0x${string}`)).toBe(
      userRegistrySalt(namehash(NAME) as `0x${string}`),
    );
  });

  it("ignores address casing, so a checksummed owner is the same owner", () => {
    expect(resolverSalt(OWNER.toUpperCase().replace("0X", "0x") as typeof OWNER)).toBe(
      resolverSalt(OWNER),
    );
  });

  it("separates owners, names, versions, and the two kinds", () => {
    expect(resolverSalt(OWNER)).not.toBe(resolverSalt(OTHER));
    expect(resolverSalt(OWNER)).not.toBe(resolverSalt(OWNER, 1n));
    expect(userRegistrySalt(namehash(NAME) as `0x${string}`)).not.toBe(
      userRegistrySalt(namehash("other.eth") as `0x${string}`),
    );
    // The two schemes hash different kind strings, so a resolver salt and a
    // registry salt can never collide for the same 32-byte subject.
    expect(resolverSalt(OWNER)).not.toBe(
      userRegistrySalt(`0x${OWNER.slice(2).padStart(64, "0")}` as `0x${string}`),
    );
  });
});
