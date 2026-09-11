import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Bundles the process entrypoint into one self-contained file, not just
 * transpiles it. Workspace packages ship TypeScript source with no dist (see
 * repo CLAUDE.md), so `tsc` alone can't produce a runnable `dist/index.js` —
 * everything under `@nymspace/*` must be inlined. Third-party deps are
 * bundled too rather than left external: `apps/api/node_modules` only links
 * packages `@nymspace/api` itself depends on, not the transitive deps of the
 * workspace packages it pulls in (drizzle-orm, pg, viem via
 * @nymspace/store/ens/privy), so a "just resolve it from node_modules at
 * runtime" bundle fails with ERR_MODULE_NOT_FOUND the moment the process
 * touches one. Bundling them removes the runtime node_modules dependency
 * entirely — `node dist/index.js` needs nothing but Node itself.
 *
 * Must build with the `react-server` condition: `server-only`'s exports map
 * throws under every other condition, and the guarded workspace packages
 * import it at module scope. Left unresolved as a condition, this bundle
 * would fail because the default export throws at *build* time too.
 */
const root = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [resolve(root, "..", "src", "index.ts")],
  outfile: resolve(root, "..", "dist", "index.js"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  conditions: ["react-server"],
  // pg (bundled in whole) calls `require()` on node builtins at module
  // scope. esbuild's ESM output shims that with a `require` it expects the
  // runtime to already have in scope — true for CJS, not for native ESM —
  // so it throws "Dynamic require ... is not supported" the moment pg
  // loads. `packages/store/src/db.ts` also uses `import.meta.url`, which
  // only exists in ESM output, ruling out `format: "cjs"` as the fix. Giving
  // the bundle its own module-scoped `require` via `createRequire` is the
  // standard esbuild recipe for this combination.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: "info",
});
