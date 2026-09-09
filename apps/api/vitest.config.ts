import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

/**
 * Load the repo-root `.env` before the suite starts, the same way
 * `packages/store` does. Vitest is not invoked through `tsx`, so without this a
 * handler test fails with "DATABASE_URL is required" while the dev server runs
 * fine — a difference that reads as an application bug rather than a missing
 * flag.
 */
const rootEnv = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

/**
 * Two resolution problems, one config, and both are documented where they bite.
 *
 * `server-only` exports a throwing module under every condition except
 * `react-server`, and it ships JavaScript, so it is externalised and needs
 * `externalConditions` as well as `conditions`. That is the repo-wide one.
 *
 * The second arrived with `@nymspace/store`. `pg` publishes an exports map of
 * `{import: "./esm/index.mjs", require: "./lib/index.js"}`, and with `import`
 * ahead of `require` Vitest resolves the ESM wrapper, which re-exports the
 * CommonJS build — whose pool class `extends` a value it required from
 * `pg-pool`. Through that path the value arrives as a Module namespace object
 * and the suite dies at import time with:
 *
 *   TypeError: Class extends value [object Module] is not a constructor or null
 *
 * thrown from inside `node_modules` with nothing pointing at a test config.
 * Asking for `require` before `import` gets pg's CommonJS build, which is the
 * one it works from. `react-server` still leads, because `server-only` is the
 * guard every package here depends on.
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
  },
});
