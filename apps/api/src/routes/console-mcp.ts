import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { DepsEnv } from "../deps";
import { createConsoleServer, type ConsoleFetch } from "../mcp/console-server";

/**
 * `/v1/mcp/console` — the New agent screen, reachable by an agent.
 *
 * Under `/v1` and inside `DEPENDENT_ROUTES`, which is the whole difference
 * between this and `/mcp/:label`. Those are the fleet's public servers and the
 * route that mounts them throws if `deps` is present, because a read-only
 * endpoint holding the store and the signing keys is the failure that guard
 * exists to make impossible. This one needs exactly what that one refuses, so
 * it is a different path, a different file, and gated.
 *
 * ## The gate
 *
 * A bearer token in `CONSOLE_MCP_TOKEN`, compared in constant time. Unset, the
 * endpoint answers 503 and names the variable — the pattern `requireDeployed()`
 * and `NoSignerError` already use, where a missing credential removes a
 * capability rather than leaving it open. It is never "no token configured, so
 * allow everyone", which is how an endpoint like this becomes public by
 * omission on the one deployment nobody checked.
 *
 * The token is compared against a fixed-length digest rather than the raw
 * strings, because `===` on secrets returns as soon as two bytes differ and
 * the time it took says how long the shared prefix was.
 */

/** Constant-time equality over the two tokens' SHA-256 digests. */
async function tokenMatches(offered: string, expected: string): Promise<boolean> {
  const digest = async (value: string) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    );

  const [a, b] = await Promise.all([digest(offered), digest(expected)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i]! ^ b[i]!;
  return difference === 0;
}

/**
 * How a tool reaches a product route.
 *
 * The app fetches itself. `c.req.raw.url` gives the origin this request
 * actually arrived on, so the loopback call carries no hardcoded host and
 * works behind Railway's proxy, in a test against `app.fetch`, and on a
 * laptop. Dependencies are already on the context for `/v1/*`, so the inner
 * request runs through the same middleware, the same validator and the same
 * logger as any other caller — which is the point: one implementation of
 * "create an agent", not a second one that drifts.
 */
function loopback(app: { fetch: (request: Request) => Response | Promise<Response> }, from: string): ConsoleFetch {
  return (path, init) => {
    const url = new URL(path, from);
    return Promise.resolve(app.fetch(new Request(url, init)));
  };
}

export function consoleMcp(app: {
  fetch: (request: Request) => Response | Promise<Response>;
}) {
  return new Hono<DepsEnv>().on(
    ["GET", "POST", "DELETE"],
    "/console",
    async (c) => {
      const expected = process.env["CONSOLE_MCP_TOKEN"];
      if (!expected) {
        throw new HTTPException(503, {
          message:
            "the console MCP server is not configured; set CONSOLE_MCP_TOKEN to enable it",
        });
      }

      const offered = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
      if (!offered || !(await tokenMatches(offered, expected))) {
        /*
          Returned, not thrown, because this response carries a header.

          `app.onError` re-renders every `HTTPException` as JSON on purpose —
          `docs/10` opens by saying every response is JSON, and `getResponse()`
          answers with a text body — but re-rendering also drops the headers the
          exception was carrying. `WWW-Authenticate` is how a client learns to
          retry with a token instead of guessing from a bare 401, so it has to
          survive. The body is the same shape the error handler would have
          produced, so a caller parses one thing either way.
        */
        return c.json(
          {
            error: "a bearer token is required",
            status: 401,
            requestId: c.var.requestId,
          },
          401,
          { "www-authenticate": 'Bearer realm="nymspace console"' },
        );
      }

      const server = createConsoleServer(
        c.var.deps,
        loopback(app, c.req.raw.url),
      );
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);
      return transport.handleRequest(c.req.raw);
    },
  );
}
