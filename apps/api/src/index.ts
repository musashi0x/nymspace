import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { apiConfig } from "./config";
import { agents } from "./routes/agents";

/**
 * The Nymspace API.
 *
 * Hono over web-standard Request and Response, the same primitives the Next
 * route handlers use, so a handler moves between the two without a rewrite.
 * Domain logic is imported from the workspace packages rather than
 * reimplemented — `docs/17_RISKS_AND_FALLBACKS.md` Risk 1 asks for one blast
 * radius when the ENSv2 beta moves, and two servers sharing one `EnsService`
 * still counts as one.
 *
 * Run with `--conditions=react-server`. The packages guard their entrypoints
 * with `server-only`, whose exports map answers that condition and no other;
 * without the flag every guarded import dies with a misleading "Client
 * Component" error. The dev and start scripts set it.
 */
const config = apiConfig();
const app = new Hono();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: config.allowedOrigins,
    allowMethods: ["GET", "POST", "OPTIONS"],
    credentials: true,
  }),
);

app.get("/health", (c) =>
  c.json({ status: "ok", service: "@nymspace/api", uptime: process.uptime() }),
);

app.route("/v1/agents", agents);

app.notFound((c) => c.json({ error: "not found", path: c.req.path }, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal error" }, 500);
});

serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`@nymspace/api listening on http://localhost:${port}`);
});

export type AppType = typeof app;
export { app };
