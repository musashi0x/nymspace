import { defineConfig } from "vitest/config";

/**
 * `server-only` exports a throwing module under every condition except
 * `react-server`, and it ships JavaScript, so it is externalised and needs
 * `externalConditions` as well as `conditions`. Same reasoning as
 * `apps/api/vitest.config.ts`.
 *
 * These tests reach no network: every case drives `Agent0Client` through an
 * injected `fetchImpl`. The live assertions live in the Gate B runner, where a
 * provider outage is a gate result rather than a red test suite.
 */
const CONDITIONS = ["react-server", "import", "node", "default"];

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
        inline: [/@nymspace\//],
      },
    },
  },
});
