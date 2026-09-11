import { serve } from "@hono/node-server";
import { createApp, type AppType } from "./app";
import { apiConfig } from "./config";
import { createLog, stdoutSink } from "./log";

/**
 * The Nymspace API.
 *
 * Hono over web-standard Request and Response, the same primitives the Next
 * route handlers use, so a handler moves between the two without a rewrite.
 * Domain logic is imported from the workspace packages rather than
 * reimplemented — docs/17_RISKS_AND_FALLBACKS.md Risk 1 asks for one blast
 * radius when the ENSv2 beta moves, and two servers sharing one package still
 * counts as one.
 *
 * Run with `--conditions=react-server`. The packages guard their entrypoints
 * with `server-only`, whose exports map answers that condition and no other;
 * without the flag every guarded import dies with a misleading "Client
 * Component" error. `pnpm conditions:check` enforces it.
 *
 * This module is the process, not the application. Everything testable lives in
 * `app.ts`, which binds no socket.
 */
const config = apiConfig();
const app = createApp(config);

serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  createLog(stdoutSink).info(`@nymspace/api listening on http://localhost:${port}`, { port });
});

export { app, type AppType };
