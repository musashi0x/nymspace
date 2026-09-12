import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { DepsEnv } from "./deps";

/**
 * A bearer token on everything that spends.
 *
 * `POST /v1/agents` was open. An empty body to the deployed API answered 400
 * from the validator, which means nothing checked a caller first: anyone who
 * knew the URL could register subnames under the organization's name, at the
 * organization's expense, until the gas ran out. The same was true of the
 * routes that grant permissions, write records, and send payments.
 *
 * It stayed open because closing it looked like it would take the console
 * offline — the browser has no credential to offer. It does now: the web app
 * proxies its writes through a route handler of its own that adds the token
 * server-side, so the secret never reaches the client and the console keeps
 * working. `apps/web/app/api/gateway/[...path]/route.ts`.
 *
 * ## Reads stay open, and that is deliberate
 *
 * Every GET, and `POST /v1/chat`, answer anyone. They read public chain state
 * and a store that holds no secrets, and the product's whole argument is that
 * its claims are checkable — putting a token in front of "what does the
 * resolver say about this name" would make the evidence harder to verify
 * without making anything safer.
 *
 * The line is therefore not read/write in the HTTP sense but *does this cost
 * the organization something*: gas, a payment, or a paid API call. That is why
 * `/v1/discover` is here, despite being a search — it spends model credits per
 * call, and an open endpoint that bills the operator is a hole whether or not
 * it changes any state.
 */

/** Paths whose POSTs require the token. Prefix match, so `/v1/agents/*` is covered. */
export const GUARDED_WRITE_PREFIXES = [
  "/v1/agents",
  "/v1/mcp/connect",
  "/v1/discover",
] as const;

/** Constant-time equality over the two tokens' SHA-256 digests. */
export async function tokenMatches(
  offered: string,
  expected: string,
): Promise<boolean> {
  const digest = async (value: string) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    );

  const [a, b] = await Promise.all([digest(offered), digest(expected)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i]! ^ b[i]!;
  return difference === 0;
}

/** The bearer token on a request, if it carries one. */
export function offeredToken(header: string | undefined): string | undefined {
  return header?.replace(/^Bearer\s+/i, "");
}

/**
 * Refuse a write that carries no valid token.
 *
 * Unset, `CONSOLE_MCP_TOKEN` makes this a 503 rather than an open door. That
 * direction is the whole point: a deployment nobody configured refuses to
 * spend rather than letting anyone spend, which is the arrangement
 * `requireDeployed()` and `NoSignerError` already use everywhere else.
 *
 * It is the same variable the console MCP server uses, on purpose. Two tokens
 * would mean two things to rotate and one of them forgotten; the capability
 * being authorized is identical either way — "may spend this organization's
 * money" — and it should not depend on which door you came through.
 */
export const requireWriteToken: MiddlewareHandler<DepsEnv> = async (c, next) => {
  if (c.req.method !== "POST") return next();

  const expected = process.env["CONSOLE_MCP_TOKEN"];
  if (!expected) {
    throw new HTTPException(503, {
      message:
        "writes are not configured on this deployment; set CONSOLE_MCP_TOKEN to enable them",
    });
  }

  const offered = offeredToken(c.req.header("authorization"));
  if (!offered || !(await tokenMatches(offered, expected))) {
    // Returned rather than thrown: `app.onError` re-renders every
    // HTTPException as JSON and drops the headers it carried, and
    // `WWW-Authenticate` is how a client learns to retry with a token instead
    // of guessing from a bare 401.
    return c.json(
      {
        error: "this endpoint spends the organization's funds and requires a bearer token",
        status: 401,
        requestId: c.var.requestId,
      },
      401,
      { "www-authenticate": 'Bearer realm="nymspace"' },
    );
  }

  return next();
};
