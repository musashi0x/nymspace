import { Hono, type ErrorHandler, type NotFoundHandler } from "hono";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { HTTPException } from "hono/http-exception";
import type { ApiConfig } from "./config";
import { withDeps, type Deps, type DepsEnv } from "./deps";
import { createLog, errorFields, requestLogger, stdoutSink, type Sink } from "./log";
import { activity } from "./routes/activity";
import { agentMcp } from "./routes/agent-mcp";
import { agents } from "./routes/agents";
import { mcpConnect } from "./routes/mcp";
import { chat } from "./routes/chat";
import { discover } from "./routes/discover";
import { github } from "./routes/github";
import { signers } from "./routes/signers";
import { traffic } from "./routes/traffic";

/**
 * Builds the application. Separate from `index.ts` so importing it binds no
 * socket: the spec requires handlers to be tested through `app.fetch`, and a
 * module that calls `serve()` at import time cannot be.
 *
 * Taking config as an argument rather than reading the environment is the other
 * half of that. A test constructs its own origins and asserts on them instead
 * of arranging process state before an import that has already hoisted — and
 * `deps` is injectable for the same reason. So is `sink`, where the process log
 * goes: a test passes one and reads the lines rather than spying on `console`.
 *
 * Routes are mounted with chained `.route()` calls and defined with chained
 * handlers, which is what makes `AppType` describe them. A route added with a
 * statement rather than a chained call still serves traffic and silently
 * disappears from the typed client, which is the one failure this arrangement
 * exists to prevent.
 */
/**
 * The routes that read `c.var.deps`, listed once.
 *
 * Previously eight hand-written `app.use` lines, two per route. Mounting a
 * ninth route without remembering to add its pair does not fail to compile and
 * does not fail to serve — the handler runs with `c.var.deps` undefined and
 * throws on the first destructure, which surfaces as a 500 with the generic
 * body `errorHandler` is supposed to produce for real faults. That cost an
 * afternoon once; a list is cheaper than the comment explaining it.
 *
 * `/health` and `/v1/github` are absent on purpose: neither touches a
 * dependency, and a liveness check that needs an RPC and a database reports
 * their health rather than its own.
 */
export const DEPENDENT_ROUTES = [
  "/v1/agents",
  "/v1/discover",
  "/v1/activity",
  "/v1/chat",
  "/v1/signers",
  "/v1/mcp",
] as const;

/** The agent MCP servers. Public, read-only, and never given `deps`. */
const isProtocolPath = (path: string) => path === "/mcp" || path.startsWith("/mcp/");

export function createApp(config: ApiConfig, deps?: Deps, sink: Sink = stdoutSink) {
  const app = new Hono<DepsEnv>();

  /**
   * Two CORS policies, split by path.
   *
   * Product routes keep the configured allowlist with credentials. The agent
   * MCP routes serve any origin without credentials, because their callers are
   * protocol clients — the MCP Inspector in a browser among them — and what
   * they serve is public, read-only data from `FLEET`. The MCP headers are
   * allowed and exposed so a browser client can negotiate a version.
   *
   * Both expose `X-Request-Id`. Without it a browser cannot read the header
   * cross-origin, and the id a person would quote from an error never reaches
   * the page.
   */
  const productCors = cors({
    origin: config.allowedOrigins,
    allowMethods: ["GET", "POST", "OPTIONS"],
    // No `allowHeaders`: Hono then reflects what the preflight asks for, so an
    // inbound `X-Request-Id` is already allowed here.
    exposeHeaders: ["x-request-id"],
    credentials: true,
  });
  const protocolCors = cors({
    origin: "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: [
      "content-type",
      "accept",
      "mcp-protocol-version",
      "mcp-session-id",
      "last-event-id",
      "x-request-id",
    ],
    exposeHeaders: ["mcp-protocol-version", "mcp-session-id", "x-request-id"],
  });

  /**
   * The request id before everything else, so the log line, CORS, the handlers
   * and the error handler all see the same one. An inbound `X-Request-Id` is
   * reused when it is at most 255 characters of `[A-Za-z0-9_=-]`, and replaced
   * with a UUID otherwise. It is for correlation: nothing authorizes on it.
   */
  app.use("*", requestId());
  app.use("*", requestLogger(sink));
  app.use("*", (c, next) =>
    isProtocolPath(c.req.path) ? protocolCors(c, next) : productCors(c, next),
  );

  /**
   * Dependencies on the product routes only.
   *
   * `/health` deliberately does not get them: a liveness check that needs an
   * RPC and a database to answer is reporting their health rather than its own,
   * and would report this process as down whenever Sepolia is slow.
   */
  for (const path of DEPENDENT_ROUTES) {
    app.use(path, withDeps(deps));
    app.use(`${path}/*`, withDeps(deps));
  }

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
    .route("/v1/chat", chat)
    .route("/v1/signers", signers)
    .route("/v1/github", github)
    .route("/v1/traffic", traffic)
    .route(
      "/v1/mcp",
      mcpConnect(config.agentMcpBaseUrl ? { exemptOrigin: config.agentMcpBaseUrl } : {}),
    )
    .route("/mcp", agentMcp(config.agentParentName));

  app.notFound(notFoundHandler);
  app.onError(errorHandler);

  return routes;
}

/**
 * Exported so the failure shapes can be tested without a route that throws on
 * demand. Typed with Hono's own handler types rather than by picking apart
 * `Parameters<...>`, which silently stopped matching the moment the app gained
 * a `Variables` type.
 *
 * Every failure body carries `requestId`. It is the handle a person copies off
 * an error screen: it names the log lines and says nothing about the fault.
 */
export const notFoundHandler: NotFoundHandler<DepsEnv> = (c) =>
  c.json({ error: "not found", path: c.req.path, requestId: c.var.requestId }, 404);

/**
 * One place where every uncaught error becomes a response.
 *
 * `HTTPException` carries its own status and message and is how the handlers
 * signal a missing agent or an unreachable provider, so it is returned as
 * written. Anything else is a bug: it is logged in full under the request's id
 * and answered with a generic 500, because an unplanned error message is the
 * most likely place for a connection string or a key to end up in a response
 * body.
 */
export const errorHandler: ErrorHandler<DepsEnv> = (err, c) => {
  const requestId = c.var.requestId;

  // Re-rendered as JSON rather than returned via `err.getResponse()`, which
  // answers with a text body. `docs/10_API_CONTRACT.md` opens by saying every
  // response is JSON, and a client that parses every success and one failure
  // differently will eventually parse the failure as a success.
  if (err instanceof HTTPException) {
    return c.json({ error: err.message, status: err.status, requestId }, err.status);
  }

  // `requestLogger` sets `c.var.log` on every app `createApp` builds. The
  // fallback covers this handler mounted on a bare `Hono`, where throwing from
  // inside the error handler would lose the original error entirely.
  const log = c.var.log ?? createLog(stdoutSink, { requestId });
  log.error(`unhandled ${err.name}`, {
    method: c.req.method,
    path: c.req.path,
    ...errorFields(err),
  });
  return c.json({ error: "internal error", requestId }, 500);
};

export type AppType = ReturnType<typeof createApp>;
