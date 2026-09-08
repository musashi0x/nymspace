/**
 * Fail when a non-Next entrypoint runs without the `react-server` export
 * condition.
 *
 * Why this exists: the `server-only` package exports
 * `{"react-server": "./empty.js", "default": "./index.js"}`, and `index.js`
 * throws at module scope. Next resolves `react-server` for its server graph and
 * the throwing module for client bundles, which is the build-time guard the
 * monorepo-workspace spec asks for. Every other consumer — a standalone server,
 * a script under tsx — also resolves the throwing module, so importing
 * `@nymspace/ens` outside Next dies with:
 *
 *   "This module cannot be imported from a Client Component module."
 *
 * in a process that has no components at all. That message sends you looking at
 * bundling. The fix is one flag, and this check is what stops the flag being
 * forgotten.
 *
 * Run: pnpm conditions:check
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const REQUIRED_FLAG = "--conditions=react-server";

/** Runtimes that resolve export conditions themselves, unlike `next`. */
const RUNTIMES = ["tsx", "node"];

interface Offence {
  packageName: string;
  scriptName: string;
  command: string;
}

function workspaceManifests(): string[] {
  const found = [join(root, "package.json")];

  for (const group of ["apps", "packages"]) {
    const dir = join(root, group);
    if (!existsSync(dir)) continue;

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = join(dir, entry.name, "package.json");
      if (existsSync(manifest)) found.push(manifest);
    }
  }
  return found;
}

/**
 * True when the command hands a source file to a runtime that resolves export
 * conditions. `next dev` is excluded because Next sets its own conditions; a
 * bare `tsc` or `vitest` is excluded because neither takes an entrypoint this
 * way. Vitest resolves conditions through its own config instead.
 */
function runsSourceEntrypoint(command: string): boolean {
  const tokens = command.split(/\s+/).filter(Boolean);
  const runtimeIndex = tokens.findIndex((token) => RUNTIMES.includes(token));
  if (runtimeIndex === -1) return false;

  return tokens
    .slice(runtimeIndex + 1)
    .some((token) => /\.(ts|tsx|mts|js|mjs)$/.test(token));
}

function hasCondition(command: string): boolean {
  return command.includes(REQUIRED_FLAG);
}

const offences: Offence[] = [];
let checked = 0;

for (const manifestPath of workspaceManifests()) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    name?: string;
    scripts?: Record<string, string>;
  };

  for (const [scriptName, command] of Object.entries(manifest.scripts ?? {})) {
    if (!runsSourceEntrypoint(command)) continue;
    checked++;
    if (hasCondition(command)) continue;

    offences.push({
      packageName: manifest.name ?? manifestPath,
      scriptName,
      command,
    });
  }
}

if (offences.length === 0) {
  console.log(
    `conditions: ${checked} entrypoint script${checked === 1 ? "" : "s"} run with ${REQUIRED_FLAG}`,
  );
  process.exit(0);
}

console.error(
  `These scripts run a source entrypoint without ${REQUIRED_FLAG}. Importing a\n` +
    "guarded package from one of them fails with a message about Client\n" +
    "Components, in a process that has none:\n",
);
for (const offence of offences) {
  console.error(`  ${offence.packageName} → ${offence.scriptName}`);
  console.error(`    ${offence.command}\n`);
}

process.exit(1);
