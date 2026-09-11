import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import * as z from "zod";
import { agentEndpointKey } from "@nymspace/ens";
import { Agent0ProviderError } from "@nymspace/graph";
import { ORGANIZATION_ID, type DepsEnv } from "../deps";
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

/**
 * The activity row for one attempt (design D10).
 *
 * `blocked` is recorded as `denied`: the guard is a control, and its refusal is
 * the control working — the reading the rest of the log gives every denial.
 * `no_endpoint` is recorded as `failed`, since the attempt reached nothing,
 * while the evidence keeps the outcome itself, which is what says "absent"
 * rather than "broken".
 */
function activityFor(outcome: ConnectOutcome) {
  if (outcome.status === "connected") {
    return { type: "mcp.connect.succeeded", status: "success" } as const;
  }
  if (outcome.status === "blocked") {
    return { type: "mcp.connect.blocked", status: "denied" } as const;
  }
  return { type: "mcp.connect.failed", status: "failed" } as const;
}

/** The endpoint is remote text; the summary shows it bounded. */
const SUMMARY_ENDPOINT_LIMIT = 200;

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
        let agentId: string | undefined;
        let subject: string;

        if (target.kind === "fleet") {
          const agent = await store.getAgent(target.agentId);
          if (!agent) agentNotFound(target.agentId);
          // Read live from the record, the way the inspector reads it.
          endpoint = (await ens.readText(agent.ensName, agentEndpointKey("mcp"))) || null;
          expectedName = agent.ensName;
          agentId = agent.id;
          subject = agent.ensName;
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
          // The validated key, not the registration's self-description.
          subject = `Agent0 ${target.graphAgentKey}`;
        }

        const source = target.kind === "fleet" ? ("ens" as const) : ("graph" as const);

        // Absence, not failure: nothing is published, so nothing is dialled.
        const result: ConnectOutcome = endpoint
          ? {
              ...(await handshake(endpoint, {
                fetch: guardedFetch,
                ...(expectedName && { expectedName }),
                ...(claimedTools && { claimedTools }),
              })),
              endpoint,
              endpointSource: source,
              readAt: readAt(),
            }
          : { status: "no_endpoint", endpoint: null, endpointSource: source, readAt: readAt() };

        // Inside the throttle, so a repeat answered from the cooldown is not a
        // second attempt and is not logged as one.
        const { type, status } = activityFor(result);
        const shown = !result.endpoint
          ? "none published"
          : result.endpoint.length > SUMMARY_ENDPOINT_LIMIT
            ? `${result.endpoint.slice(0, SUMMARY_ENDPOINT_LIMIT)}…`
            : result.endpoint;
        const metadata: Record<string, string | number> = {};
        if ("stage" in result) metadata["stage"] = result.stage;
        if ("rule" in result) metadata["rule"] = result.rule;
        if ("httpStatus" in result && result.httpStatus !== undefined) {
          metadata["httpStatus"] = result.httpStatus;
        }

        await store.recordEvent({
          organizationId: ORGANIZATION_ID,
          ...(agentId && { agentId }),
          source: "mcp",
          type,
          status,
          occurredAt: result.readAt,
          summary: `MCP connect to ${subject} (${shown}): ${result.status}`,
          evidence: {
            source: "mcp",
            endpoint: result.endpoint,
            endpointSource: result.endpointSource,
            outcome: result.status,
            readAt: result.readAt,
          },
          metadata,
        });

        return result;
      });

      return c.json(outcome);
    },
  );
}
