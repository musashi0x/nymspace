import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { fleetAgent } from "@nymspace/core";
import { createAgentServer } from "../mcp/servers";

/**
 * `/mcp/:label` — each fleet agent's MCP endpoint.
 *
 * A protocol route, not a product route, so it sits outside `/v1`. Its URL is
 * written to ENS, and MCP negotiates its own version in `MCP-Protocol-Version`;
 * a version segment here would bake the HTTP API's version into chain state,
 * and bumping the API would mean a `setText` per agent (design D2).
 *
 * Stateless streamable HTTP with JSON responses: every request builds its own
 * server and transport, nothing survives it, and a restart or a second replica
 * cannot strand a session (design D3).
 *
 * The query string is ignored because the path parameter never sees it. The
 * permission proof and `verify-identity.ts` write `…/research?proof=<ts>` to
 * force a changing record value, and those URLs must still answer.
 */
export function agentMcp(parentName: string | undefined) {
  return (
    new Hono()
      /**
       * Refuses to serve if dependencies were mounted on this path.
       *
       * The typed context already has no `deps`, so no handler here can name
       * it. This catches the other half: `/mcp` being added to
       * `DEPENDENT_ROUTES`, which would hand the store, the chain client and
       * every signing key to a route anyone on the internet can call. It fails
       * loudly, as a 500 and a failing test, rather than working.
       */
      .use("*", async (c, next) => {
        if (c.get("deps" as never) !== undefined) {
          throw new Error("agent MCP routes must be mounted without dependencies");
        }
        await next();
      })
      .on(["GET", "POST", "DELETE"], "/:label", async (c) => {
        const agent = fleetAgent(c.req.param("label"));
        // The app's own not-found handler, not a copy of its shape. An unknown
        // label is not an agent, so it must not look like an MCP server with
        // no tools, and it must fail exactly the way every unknown path does,
        // whatever that shape becomes.
        if (!agent) return c.notFound();

        if (!parentName) {
          throw new HTTPException(503, {
            message: "agent MCP servers are not configured",
          });
        }

        const server = createAgentServer(agent, parentName);
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        await server.connect(transport);
        try {
          // In JSON mode this resolves once every response is ready, so the
          // body is complete before the server is closed.
          return await transport.handleRequest(c.req.raw);
        } finally {
          await server.close();
        }
      })
  );
}
