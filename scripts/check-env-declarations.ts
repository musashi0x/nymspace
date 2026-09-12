/**
 * Reconcile the three places a variable has to be declared: what Turborepo
 * hashes, what `.env.example` documents, and what `.railway/railway.ts` puts
 * on the deployed services.
 *
 * This exists because the failures it catches are silent. Turborepo hashes only
 * the variables it is told about, so an undeclared `ENSV2_PARENT_REGISTRY_ADDRESS`
 * means editing a contract address and receiving a cached build compiled
 * against the old one — which would be debugged as a contract problem, not a
 * cache problem.
 *
 * The Railway side was added after chasing a variable that appeared to be
 * missing from production. `.railway/railway.ts` opens by calling itself "the
 * whole deployed estate in one file" and says every value below "mirrors
 * `.env.example`" — and nothing checked that claim. Seven variables were
 * documented, hashed, and absent from the file, so `railway config apply`
 * could never set them.
 *
 * Absent from the deployed estate is the asymmetric case: a variable may
 * legitimately not belong on a deployed service. Two reasons for that exist
 * and they are different, so they are two named lists below rather than one
 * heuristic — the next person adding to either has to say which.
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

/**
 * Names the deployed services have no business carrying.
 *
 * Every one of them describes a laptop: a local database, a port bound on this
 * machine, an origin that is not the deployed one. Railway sets its own
 * `DATABASE_URL`, `PORT` and domain references, so requiring these there would
 * be requiring production to be wrong.
 */
const LOCAL_ONLY = new Set([
  "DATABASE_URL",
  "API_PORT",
  "PORT",
  "WEB_ORIGIN",
  "NEXT_PUBLIC_API_URL",
  "NODE_ENV",
]);

/**
 * The read-only form of a credential the deployment supplies as a key.
 *
 * `.env.example` is explicit that these are set *instead of* the private keys,
 * and ignored when both are present, because reads need to know which account
 * to check permissions for and not how to sign as it. A deployment that holds
 * the keys and not these is correctly configured, so "missing from Railway" is
 * not a finding — setting both would be the contradiction.
 *
 * Named separately from {@link LOCAL_ONLY} because the reason is different and
 * the next person to add one needs to pick deliberately. A variable that is
 * genuinely required on the deployed services belongs in neither.
 */
const KEY_ALTERNATIVES = new Set([
  "ENSV2_ORGANIZATION_ADDRESS",
  "ENSV2_AGENT_CONTROLLER_ADDRESS",
]);

/**
 * Every variable name `.railway/railway.ts` assigns.
 *
 * Read as text rather than imported. The module pulls in `railway/iac`, which
 * is not a dependency of this script's process and would make a config-file
 * check fail for reasons that have nothing to do with the config. What is being
 * asserted is that a name appears as a key, and that is visible in the source.
 */
function declaredInRailway(): Set<string> {
  const raw = readFileSync(resolve(root, ".railway", "railway.ts"), "utf8");
  const declared = new Set<string>();

  // Any indentation: the shared blocks sit at two spaces and a service's own
  // `env: {}` at six, and a variable set only on the service it belongs to is
  // as deployed as one in the shared block.
  for (const match of raw.matchAll(/^[ \t]+([A-Z][A-Z0-9_]{2,}):/gm)) {
    if (match[1]) declared.add(match[1]);
  }
  return declared;
}

function difference(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((value) => !b.has(value)).sort();
}

const declared = declaredInTurbo();
const documented = documentedInExample();
const deployed = declaredInRailway();

const undeclared = difference(documented, declared);
const undocumented = difference(declared, documented);
const undeployed = difference(documented, deployed).filter(
  (name) => !LOCAL_ONLY.has(name) && !KEY_ALTERNATIVES.has(name),
);

if (
  undeclared.length === 0 &&
  undocumented.length === 0 &&
  undeployed.length === 0
) {
  console.log(
    `env: ${declared.size} variables — turbo.json, .env.example and ` +
      ".railway/railway.ts agree",
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

if (undeployed.length > 0) {
  console.error(
    "In .env.example but not in .railway/railway.ts — documented and hashed, " +
      "and not on the deployed services. Nothing fails at boot; whatever reads " +
      "one of these fails later, on Railway only:",
  );
  for (const name of undeployed) console.error(`  ${name}`);
  console.error(
    "\n  Add it to .railway/railway.ts — `preserve()` for a secret, a literal " +
      "for anything public — or to LOCAL_ONLY in this script if it genuinely " +
      "describes a laptop.",
  );
}

process.exit(1);
