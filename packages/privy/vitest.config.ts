import { defineConfig } from "vitest/config";

/**
 * `server-only` exports a throwing module under every condition except
 * `react-server`, and it ships JavaScript, so it is externalised and needs
 * `externalConditions` as well as `conditions`.
 *
 * These tests reach no network and hold no credential: the error-normalisation
 * mapping is pure, and the live assertions live in the Gate C runner where a
 * provider outage is a gate result rather than a red suite.
 */
const CONDITIONS = ["react-server", "import", "node", "default"];

export default defineConfig({
  ssr: { resolve: { conditions: CONDITIONS, externalConditions: CONDITIONS } },
  test: { server: { deps: { inline: [/@nymspace\//] } } },
});
