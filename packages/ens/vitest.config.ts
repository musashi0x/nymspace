import { defineConfig } from "vitest/config";

/**
 * The `react-server` condition, for suites that import past the pure modules.
 *
 * `src/chain.ts` reads `serverEnv` from `@nymspace/core/env`, which is guarded
 * by `server-only`, and `server-only` throws at import under every condition
 * except `react-server` — in a test process with no components, with an error
 * about Client Components (CLAUDE.md, "The react-server condition"). The first
 * suite to reach it was `ens-service.test.ts`; the earlier ones import only
 * pure modules and never needed this file.
 *
 * `server-only` ships JavaScript and is externalised, so the list goes in
 * `externalConditions` as well. The list itself is the one `apps/api` and
 * `packages/store` already run viem under.
 */
const CONDITIONS = ["react-server", "node", "require", "default"];

export default defineConfig({
  ssr: {
    resolve: {
      conditions: CONDITIONS,
      externalConditions: CONDITIONS,
    },
  },
  test: {
    server: {
      deps: {
        // Workspace packages ship TypeScript source, so Vitest must transform
        // them rather than externalise them the way it does published deps.
        inline: [/@nymspace\//],
      },
    },
  },
});
