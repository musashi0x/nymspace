import { Hono, type ErrorHandler, type NotFoundHandler } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { HTTPException } from "hono/http-exception";
import { NoSignerError } from "@nymspace/ens";
import type { ApiConfig } from "./config";
import { withDeps, type Deps, type DepsEnv } from "./deps";
import { activity } from "./routes/activity";
import { agents } from "./routes/agents";
import { discover } from "./routes/discover";
import { github } from "./routes/github";

/**
 * Builds the application. Separate from `index.ts` so importing it binds no
 * socket: the spec requires handlers to be tested through `app.fetch`, and a
 * module that calls `serve()` at import time cannot be.
 *
 * Taking config as an argument rather than reading the environment is the other
 * half of that. A test constructs its own origins and asserts on them instead
 * of arranging process state before an import that has already hoisted — and
 * `deps` is injectable for the same reason.
 *
 * Routes are mounted with chained `.route()` calls and defined with chained
 * handlers, which is what makes `AppType` describe them. A route added with a
 * statement rather than a chained call still serves traffic and silently
 * disappears from the typed client, which is the one failure this arrangement
 * exists to prevent.
 */
export function createApp(config: ApiConfig, deps?: Deps) {
  const app = new Hono<DepsEnv>();

  app.use("*", logger());
  app.use(
    "*",
    cors({
      origin: config.allowedOrigins,
      allowMethods: ["GET", "POST", "OPTIONS"],
      credentials: true,
    }),
  );

  /**
   * Dependencies on the product routes only.
   *
   * `/health` deliberately does not get them: a liveness check that needs an
   * RPC and a database to answer is reporting their health rather than its own,
   * and would report this process as down whenever Sepolia is slow.
   */
  app.use("/v1/agents/*", withDeps(deps));
  app.use("/v1/agents", withDeps(deps));
  app.use("/v1/discover/*", withDeps(deps));
  app.use("/v1/discover", withDeps(deps));
  app.use("/v1/activity/*", withDeps(deps));
  app.use("/v1/activity", withDeps(deps));

  const routes = app
    .get("/health", (c) =>
      c.json({
        status: "ok" as const,
        service: "@nymspace/api" as const,
        uptime: process.uptime(),
      }),
    )
    .route("/v1/agents", agents)
    .route("/v1/discover", discover)
    .route("/v1/activity", activity)
    .route("/v1/github", github);

  app.notFound(notFoundHandler);
  app.onError(errorHandler);

  return routes;
}

/**
 * Exported so the failure shapes can be tested without a route that throws on
 * demand. Typed with Hono's own handler types rather than by picking apart
 * `Parameters<...>`, which silently stopped matching the moment the app gained
 * a `Variables` type.
 */
export const notFoundHandler: NotFoundHandler<DepsEnv> = (c) =>
  c.json({ error: "not found", path: c.req.path }, 404);

/**
 * One place where every uncaught error becomes a response.
 *
 * `HTTPException` carries its own status and message and is how the handlers
 * signal a missing agent or an unreachable provider, so it is returned as
 * written. Anything else is a bug: it is logged in full and answered with a
 * generic 500, because an unplanned error message is the most likely place for
 * a connection string or a key to end up in a response body.
 */
export const errorHandler: ErrorHandler<DepsEnv> = (err, c) => {
  // Re-rendered as JSON rather than returned via `err.getResponse()`, which
  // answers with a text body. `docs/10_API_CONTRACT.md` opens by saying every
  // response is JSON, and a client that parses every success and one failure
  // differently will eventually parse the failure as a success.
  if (err instanceof HTTPException) {
    return c.json({ error: err.message, status: err.status }, err.status);
  }

  // A write attempted with no signing key is a configuration state, not a bug.
  // 503 with the remedy beats a 500 that reads as broken code, and it points
  // at the prepare route so the caller knows there is a way through.
  if (err instanceof NoSignerError) {
    return c.json(
      {
        error: err.message,
        status: 503,
        remedy:
          "Set the signing key to write from the server, or use POST /v1/agents/:id/permissions/prepare and sign in a wallet.",
      },
      503,
    );
  }

  console.error(err);
  return c.json({ error: "internal error" }, 500);
};

export type AppType = ReturnType<typeof createApp>;
