import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

/**
 * Load the repo-root `.env` before the suite starts.
 *
 * Every other entrypoint in this package reaches `DATABASE_URL` through
 * `tsx --env-file-if-exists`, but Vitest is not invoked through `tsx`, so
 * without this `pnpm test` at the root would fail with "DATABASE_URL is
 * required" while `pnpm --filter @nymspace/store db:migrate` succeeds — a
 * difference that reads as a store bug rather than a missing flag.
 */
const rootEnv = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".env",
);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

/**
 * Two resolution problems, one config.
 *
 * The first is the repo-wide one: `server-only` exports a throwing module under
 * every condition except `react-server`, and it ships JavaScript, so it is
 * externalised and needs `externalConditions` as well as `conditions`. Same
 * reasoning as `apps/api/vitest.config.ts`.
 *
 * The second is specific to this package and cost a confusing half hour, so it
 * is written down. `pg` publishes an exports map of
 * `{import: "./esm/index.mjs", require: "./lib/index.js"}`. With `import` in
 * this list ahead of `require`, Vitest resolves the ESM wrapper, which re-
 * exports the CommonJS build — and `pg/lib/index.js` builds its pool class by
 * `extends`-ing a value it required from `pg-pool`. Through that path the value
 * arrives as a Module namespace object and the whole suite dies at import time
 * with:
 *
 *   TypeError: Class extends value [object Module] is not a constructor or null
 *
 * thrown from inside `node_modules`, with nothing in the message pointing at a
 * test config. Asking for `require` before `import` gets pg's CommonJS build,
 * which is the one it actually works from. `react-server` still leads, because
 * `server-only` is the guard every package here depends on.
 */
const CONDITIONS = ["react-server", "node", "require", "default"];

export default defineConfig({
  ssr: {
    resolve: {
      conditions: CONDITIONS,
      externalConditions: CONDITIONS,
    },
    external: ["pg", "pg-native"],
  },
  test: {
    server: {
      deps: {
        // Workspace packages ship TypeScript source, so Vitest must transform
        // them rather than externalise them the way it does published deps.
        inline: [/@nymspace\//],
        external: ["pg", "pg-native"],
      },
    },
    /**
     * One database, so parallel files would race each other's fixtures. The
     * tests talk to a real Postgres rather than a double on purpose: task 2.6
     * asserts durability across a process boundary, and a fake living in the
     * test process cannot fail the way a real database can.
     */
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
