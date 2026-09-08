import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { permissionedResolverAbi } from "./abis";
import { ALL_ROLES, RESOLVER_ROLE, adminOf, bitmapHasRoles } from "./eac";

type AbiFunction = Extract<
  (typeof permissionedResolverAbi)[number],
  { type: "function" }
>;

/** The ABI is a const tuple of mixed functions and events; narrow to functions. */
function fn(name: string): AbiFunction | undefined {
  return permissionedResolverAbi.find(
    (item): item is AbiFunction => item.type === "function" && item.name === name,
  );
}


/**
 * Task 5.6 — the resolver's only working grant path is the `authorize*` family.
 *
 * `grantRoles` and `revokeRoles` exist on the resolver and are declared `pure`:
 * they compile, they accept the call, and they change nothing. A call site
 * using them would look correct in review, succeed on chain, and silently grant
 * nothing — so this is a check no runtime test can replace.
 */

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      found.push(path);
    }
  }
  return found;
}

describe("the resolver grant path", () => {
  it("declares grantRoles and revokeRoles as pure, so they do nothing", () => {
    for (const name of ["grantRoles", "revokeRoles"]) {
      // Absent is also fine — it would mean the beta removed the trap entirely.
      const fragment = fn(name);
      if (fragment) expect(fragment.stateMutability).toBe("pure");
    }
  });

  it("has no call site that would use them", () => {
    const offenders: string[] = [];

    for (const file of [
      ...sourceFiles(join(packageRoot, "src")),
      ...sourceFiles(join(packageRoot, "scripts")),
    ]) {
      const source = readFileSync(file, "utf8");
      for (const name of ["grantRoles", "revokeRoles", "grantRootRoles"]) {
        if (source.includes(`functionName: "${name}"`)) {
          offenders.push(`${file.slice(packageRoot.length + 1)}: ${name}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps authorizeTextRoles available as the path that does work", () => {
    expect(fn("authorizeTextRoles")?.stateMutability).toBe("nonpayable");
  });
});

describe("the resolver initialization bitmap", () => {
  /**
   * Task 5.4b. An admin role confers grant and revoke authority and never the
   * action, so a bitmap of admin bits alone would let the organization delegate
   * the ENSIP 25 key and then be unable to write it. ALL_ROLES carries both
   * halves of every slot, which is why it is what the proxy is initialized with.
   */
  it("carries ROLE_SET_TEXT as well as ROLE_SET_TEXT_ADMIN", () => {
    expect(bitmapHasRoles(ALL_ROLES, RESOLVER_ROLE.SET_TEXT)).toBe(true);
    expect(bitmapHasRoles(ALL_ROLES, adminOf(RESOLVER_ROLE.SET_TEXT))).toBe(true);
  });

  it("carries both halves of every resolver role", () => {
    for (const role of Object.values(RESOLVER_ROLE)) {
      expect(bitmapHasRoles(ALL_ROLES, role, adminOf(role))).toBe(true);
    }
  });
});
