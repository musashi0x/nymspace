/**
 * Reconcile the environment variables Turborepo hashes against the ones
 * `.env.example` documents.
 *
 * This exists because the failure it catches is silent. Turborepo hashes only
 * the variables it is told about, so an undeclared `ENSV2_PARENT_REGISTRY_ADDRESS`
 * means editing a contract address and receiving a cached build compiled
 * against the old one — which would be debugged as a contract problem, not a
 * cache problem.
 *
 * Run: pnpm env:check
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface TurboConfig {
  globalEnv?: string[];
  tasks?: Record<string, { env?: string[] }>;
}

function declaredInTurbo(): Set<string> {
  const raw = readFileSync(resolve(root, "turbo.json"), "utf8");
  const config = JSON.parse(raw) as TurboConfig;

  const declared = new Set(config.globalEnv ?? []);
  for (const task of Object.values(config.tasks ?? {})) {
    for (const name of task.env ?? []) declared.add(name);
  }
  return declared;
}

function documentedInExample(): Set<string> {
  const raw = readFileSync(resolve(root, ".env.example"), "utf8");
  const documented = new Set<string>();

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const [key] = trimmed.split("=");
    if (key) documented.add(key.trim());
  }
  return documented;
}

function difference(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((value) => !b.has(value)).sort();
}

const declared = declaredInTurbo();
const documented = documentedInExample();

const undeclared = difference(documented, declared);
const undocumented = difference(declared, documented);

if (undeclared.length === 0 && undocumented.length === 0) {
  console.log(
    `env: ${declared.size} variables, turbo.json and .env.example agree`,
  );
  process.exit(0);
}

if (undeclared.length > 0) {
  console.error(
    "In .env.example but not declared in turbo.json — these are not hashed, " +
      "so changing one serves a stale cached build:",
  );
  for (const name of undeclared) console.error(`  ${name}`);
}

if (undocumented.length > 0) {
  console.error(
    "Declared in turbo.json but missing from .env.example — the documented " +
      "surface and the validated surface disagree:",
  );
  for (const name of undocumented) console.error(`  ${name}`);
}

process.exit(1);
