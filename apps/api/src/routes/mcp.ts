import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import * as z from "zod";
import { agentEndpointKey } from "@nymspace/ens";
import { Agent0ProviderError } from "@nymspace/graph";
import type { DepsEnv } from "../deps";
import { createGuardedFetch } from "../mcp/guard";
import { handshake, throttled, type ConnectOutcome } from "../mcp/connect";
import { agentNotFound, readAt } from "./shared";

/**
 * `POST /v1/mcp/connect` — is this agent's MCP endpoint real, and what does it
 * offer?
 *
 * The body names an agent, never a URL (design D6). This API has no caller
 * authentication, so a route that took a URL would be an open proxy with a
 * guard in front of it; taking an identifier limits every target to a value
 * somebody published to a registry, and that value still passes the guard.
 * Strict objects, so a `url` field is a 400 rather than an ignored extra.
 *
 * Every outcome is a 200, including every failure: "the endpoint did not
 * answer" is the route working. A 5xx means this API failed.
 */

const connectSchema = z.strictObject({
  target: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("fleet"), agentId: z.string().min(1).max(100) }),
    z.strictObject({
      kind: z.literal("graph"),
      graphAgentKey: z.string().regex(/^\d+:\d+$/, "must be <chainId>:<agentId>"),
    }),
  ]),
});

export function mcpConnect(options: { exemptOrigin?: string } = {}) {
  const guardedFetch = createGuardedFetch(
    options.exemptOrigin ? { exemptOrigin: options.exemptOrigin } : {},
  );

  return new Hono<DepsEnv>().post(
    "/connect",
    zValidator("json", connectSchema),
    async (c) => {
      const { store, ens, graph } = c.var.deps;
      const { target } = c.req.valid("json");
      const key =
        target.kind === "fleet" ? `fleet:${target.agentId}` : `graph:${target.graphAgentKey}`;

      const outcome = await throttled(key, async (): Promise<ConnectOutcome> => {
        let endpoint: string | null;
        let expectedName: string | undefined;
        // Only a discovered agent has one: ENS holds no claim about tools.
        let claimedTools: readonly string[] | undefined;

        if (target.kind === "fleet") {
          const agent = await store.getAgent(target.agentId);
          if (!agent) agentNotFound(target.agentId);
          // Read live from the record, the way the inspector reads it.
          endpoint = (await ens.readText(agent.ensName, agentEndpointKey("mcp"))) || null;
          expectedName = agent.ensName;
        } else {
          let agent;
          try {
            agent = await graph.agentProfile(target.graphAgentKey);
          } catch (error) {
            if (error instanceof Agent0ProviderError) {
              throw new HTTPException(502, {
                message: `discovery provider unavailable: ${error.message}`,
              });
            }
            throw error;
          }
          if (!agent) {
            throw new HTTPException(404, {
              message: `no Agent0 agent ${target.graphAgentKey}`,
            });
          }
          endpoint = agent.mcpEndpoint ?? null;
          expectedName = agent.claimedEnsName;
          claimedTools = agent.mcpTools;
        }

        const source = target.kind === "fleet" ? ("ens" as const) : ("graph" as const);
        if (!endpoint) {
          // Absence, not failure: nothing is published, so nothing is dialled.
          return { status: "no_endpoint", endpoint: null, endpointSource: source, readAt: readAt() };
        }

        const result = await handshake(endpoint, {
          fetch: guardedFetch,
          ...(expectedName && { expectedName }),
          ...(claimedTools && { claimedTools }),
        });
        return { ...result, endpoint, endpointSource: source, readAt: readAt() };
      });

      return c.json(outcome);
    },
  );
}
