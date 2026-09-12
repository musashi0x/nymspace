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
 * ## Two things are not source entrypoints, and this used to fail on both
 *
 * `@nymspace/api`'s `build` (`node scripts/build.mjs`) and `start:dist`
 * (`node dist/index.js`) were flagged from the day the check was written, and
 * neither was ever wrong. `build.mjs` imports esbuild and node builtins — it
 * touches none of the guarded graph, and the condition it needs belongs in the
 * bundler call, which is where it already is. `dist/index.js` is that bundle's
 * output: `server-only` was resolved to the empty module at build time and no
 * import of it survives, so a flag on the node command would resolve nothing.
 *
 * A check that is red for reasons nobody can act on is worse than no check. It
 * gets explained in a PR body once and then ignored, and the day a real
 * offence appears it lands in a column that was already red. So the two shapes
 * are recognised rather than exempted, and recognising them made the check
 * stronger: a compiled entrypoint is accepted only when the build that
 * produced it resolves the condition, and a build driver only when its own
 * source does. Delete `conditions: ["react-server"]` from `build.mjs` and both
 * scripts start failing — which is the failure worth catching, and the one the
 * old heuristic could not see because it was already failing for other reasons.
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
  /** Why this one is an offence, when the plain missing flag is not the reason. */
  because?: string;
}

/** Path segments that hold build output rather than source. */
const OUTPUT_DIRS = ["dist", "build", ".next", "out"];

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

/** The file a runtime was handed, or nothing when it was handed none. */
function entrypointOf(command: string): string | undefined {
  const tokens = command.split(/\s+/).filter(Boolean);
  const runtimeIndex = tokens.findIndex((token) => RUNTIMES.includes(token));
  if (runtimeIndex === -1) return undefined;

  return tokens
    .slice(runtimeIndex + 1)
    .find((token) => /\.(ts|tsx|mts|js|mjs)$/.test(token));
}

/**
 * Build output, where the condition was already resolved by the bundler.
 *
 * A flag on the command line would resolve nothing here: the bundle has no
 * `server-only` import left to resolve. What has to be true instead is that
 * the build which produced it asked for the condition, which is checked below
 * rather than assumed.
 */
function isCompiledOutput(entrypoint: string): boolean {
  return entrypoint
    .split("/")
    .some((segment) => OUTPUT_DIRS.includes(segment));
}

/**
 * A script that drives a bundler, rather than one that runs the app.
 *
 * It imports the bundler and node builtins, never the guarded packages, so it
 * needs no condition itself — it needs to *pass* one, and that is a fact about
 * its source, not about how it was launched.
 */
function declaresConditionInSource(
  manifestPath: string,
  entrypoint: string,
): boolean {
  const file = resolve(dirname(manifestPath), entrypoint);
  if (!existsSync(file)) return false;
  return readFileSync(file, "utf8").includes("react-server");
}

/**
 * Does this package's `build` script resolve the condition?
 *
 * Either directly on the command line, or inside the driver it runs. Read
 * rather than trusted: it is the only thing standing behind every `dist/`
 * entrypoint the loop above waves through.
 */
function buildResolvesCondition(
  manifestPath: string,
  scripts: Record<string, string>,
): boolean {
  const build = scripts["build"];
  if (!build) return false;
  if (hasCondition(build)) return true;

  const driver = entrypointOf(build);
  return driver ? declaresConditionInSource(manifestPath, driver) : false;
}

const offences: Offence[] = [];
let checked = 0;

for (const manifestPath of workspaceManifests()) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    name?: string;
    scripts?: Record<string, string>;
  };

  const scripts = manifest.scripts ?? {};

  for (const [scriptName, command] of Object.entries(scripts)) {
    if (!runsSourceEntrypoint(command)) continue;
    checked++;
    if (hasCondition(command)) continue;

    const packageName = manifest.name ?? manifestPath;
    const entrypoint = entrypointOf(command);

    // Compiled output: accepted only because the build behind it asked for the
    // condition. If that stops being true this is a real offence, and naming
    // the build is what makes it fixable.
    if (entrypoint && isCompiledOutput(entrypoint)) {
      if (buildResolvesCondition(manifestPath, scripts)) continue;
      offences.push({
        packageName,
        scriptName,
        command,
        because:
          `runs build output, but this package's \`build\` script does not resolve\n` +
          `    ${REQUIRED_FLAG} — so the bundle it runs was built against the\n` +
          "    throwing copy of `server-only`",
      });
      continue;
    }

    // A build driver passes the condition to its bundler instead of receiving
    // it. That has to be in the file, not in the reviewer's memory.
    if (entrypoint && declaresConditionInSource(manifestPath, entrypoint)) {
      continue;
    }

    offences.push({ packageName, scriptName, command });
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
  console.error(`    ${offence.command}`);
  if (offence.because) console.error(`    ${offence.because}`);
  console.error("");
}

process.exit(1);
