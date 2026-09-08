import { defineConfig } from "vitest/config";

/**
 * `server-only` exports a throwing module under every condition except
 * `react-server`, so without these the first import of a guarded package fails
 * with a message about Client Components in a process that has none. This is
 * the test-runner equivalent of the `--conditions=react-server` flag the dev
 * and start scripts carry.
 *
 * It goes under `ssr`, not top-level `resolve`: tests run in the SSR module
 * graph, and `externalConditions` is the one that governs packages Vite leaves
 * externalised — which `server-only` is, since it ships JavaScript.
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
        // Workspace packages ship TypeScript source, so Vitest must transform
        // them rather than externalise them the way it does published deps.
        inline: [/@nymspace\//],
      },
    },
  },
});
