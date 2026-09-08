import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { ApiConfig } from "./config";
import { activity } from "./routes/activity";
import { agents } from "./routes/agents";

/**
 * Builds the application. Separate from `index.ts` so that importing it binds
 * no socket: the spec requires handlers to be tested through `app.fetch`, and a
 * module that calls `serve()` at import time cannot be.
 *
 * Taking config as an argument rather than reading the environment here is the
 * other half of that. A test constructs its own origins and asserts on them,
 * instead of arranging process state before an import that has already hoisted.
 */
export function createApp(config: ApiConfig) {
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

  const routes = app
    .get("/health", (c) =>
      c.json({
        status: "ok",
        service: "@nymspace/api",
        uptime: process.uptime(),
      }),
    )
    .route("/v1/agents", agents)
    .route("/v1/activity", activity);

  app.notFound(notFoundHandler);
  app.onError(errorHandler);

  return routes;
}

/** Exported so the failure shapes can be tested without a route that throws on demand. */
export const notFoundHandler = (c: Parameters<Parameters<Hono["notFound"]>[0]>[0]) =>
  c.json({ error: "not found", path: c.req.path }, 404);

export const errorHandler = (
  err: Error,
  c: Parameters<Parameters<Hono["onError"]>[0]>[1],
) => {
  console.error(err);
  return c.json({ error: "internal error" }, 500);
};

export type AppType = ReturnType<typeof createApp>;
