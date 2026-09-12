import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";
import type { Deps } from "../deps";

/**
 * The console's own MCP server — the New agent screen, as tools.
 *
 * `servers.ts` holds the fleet's public endpoints: one per agent, read-only,
 * and structurally unable to reach authority because the route that mounts
 * them refuses to run with `deps` on its context. This is the opposite server
 * and belongs in its own file so the two are never confused. It holds `deps`,
 * it creates agents, and creating an agent registers an ENS subname and spends
 * the organization's gas.
 *
 * ## Why it is gated when `POST /v1/agents` is not
 *
 * That route is open today: a `POST` with an empty body to the deployed API
 * answers 400 from the validator, which means nothing checked a caller first.
 * Anyone who knows the URL can mint a subname under the organization's name at
 * the organization's expense.
 *
 * This file does not inherit that. Wrapping the same capability in a protocol
 * built for autonomous callers — discoverable, self-describing, designed to be
 * handed to a model and left running — turns a hole somebody has to find into
 * one that advertises itself. So the token is required here from the first
 * commit rather than added later, and with `CONSOLE_MCP_TOKEN` unset the
 * endpoint reports itself unconfigured rather than serving unauthenticated:
 * the arrangement `docs/08` asks for everywhere else, where an absent
 * credential removes a capability instead of silently widening it.
 *
 * Closing the hole on `POST /v1/agents` itself is a separate change — the
 * deployed console calls it from a browser with no credential to offer, so
 * gating it without giving the web app a way to authenticate would take the
 * product offline.
 */

const VERSION = "0.1.0";

/** A tool that reads and nothing else. */
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/**
 * Creating an agent, as hinted to a client that may retry on its own.
 *
 * `destructiveHint: false` holds only because of the guard below. It is not
 * free: `POST /v1/agents` accepts a label the organization already owns and
 * re-runs provisioning on it, which rewrites that agent's `agent-context`
 * record on chain with whatever name and description the caller sent. On the
 * New agent form that is the documented repair path, reached deliberately by a
 * person who typed a name they had used before. Through a tool called
 * `create_agent`, it is a live agent being quietly overwritten by a retry.
 *
 * Found by doing it: a call with `label: "research"` and a throwaway
 * description, expected to be refused, returned 202 and wrote
 * `{"name":"Dup","description":"should be refused"}` onto
 * `research.nymspace.eth`. Nothing was wrong with the route — the label was not
 * owned by *another* account, which is the only thing it checks — and nothing
 * about the tool said otherwise.
 *
 * `idempotentHint: true` is now true in the sense a client will read it:
 * calling twice with the same arguments creates one agent and then refuses,
 * changing nothing further.
 */
const CREATES = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

function text(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

/** What `create_agent` accepts, mirroring `agentCreateSchema`'s shape. */
const createShape = {
  label: z
    .string()
    .describe(
      "The subname to register, lowercase letters, digits and internal hyphens. " +
        "Becomes <label>.<parent>.",
    ),
  name: z.string().min(1).describe("Display name."),
  description: z.string().min(1).describe("What this agent is for."),
  role: z.string().min(1).describe("Its role in the fleet."),
  controller: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .describe("The address that will control this agent's records."),
  mcpEndpoint: z.string().url().optional().describe("https MCP endpoint, if any."),
  a2aEndpoint: z.string().url().optional().describe("https A2A endpoint, if any."),
  delegate: z
    .boolean()
    .optional()
    .describe(
      "Grant the controller permission to write its own records. Defaults to false: " +
        "a fleet needs at least one name whose controller holds no grant.",
    ),
};

/**
 * How the tools reach the product routes.
 *
 * A function rather than the handlers, because the handlers are inline in
 * `routes/agents.ts` by Hono's own rule — an extracted handler loses its path
 * parameter type, and a route added with a statement vanishes from `AppType`.
 * Calling the app the same way a client would keeps one implementation of
 * "create an agent" rather than two that drift: the same validator, the same
 * label check, the same activity rows.
 */
export interface ConsoleFetch {
  (path: string, init?: RequestInit): Promise<Response>;
}

export function createConsoleServer(
  deps: Deps,
  call: ConsoleFetch,
): McpServer {
  const server = new McpServer({
    name: `console.${deps.parentName}`,
    version: VERSION,
  });

  server.registerTool(
    "list_agents",
    {
      title: "List the fleet",
      description:
        "Every agent this organization has, with its ENS name, controller, and how far " +
        "provisioning got on each of the five tracks. Read from the coordination store, " +
        "which records how far the pipeline got — not what the chain says. Read-only.",
      annotations: READ_ONLY,
    },
    async () => {
      const response = await call("/v1/agents");
      return text(await response.json());
    },
  );

  server.registerTool(
    "describe_parent",
    {
      title: "Describe the parent name",
      description:
        "The ENS name new agents are registered under, and the chain it lives on. " +
        "Read-only.",
      annotations: READ_ONLY,
    },
    () =>
      text({
        parentName: deps.parentName,
        chainId: deps.config.chainId,
        registry: deps.registry,
        resolver: deps.resolver,
        newAgentBecomes: `<label>.${deps.parentName}`,
      }),
  );

  server.registerTool(
    "create_agent",
    {
      title: "Create an agent",
      description:
        `Registers <label>.${deps.parentName}, attaches the permissioned resolver, ` +
        "publishes the agent's records, and grants the controller only what you delegate. " +
        "Returns 202 immediately and provisions in the background — poll list_agents to " +
        "watch the five tracks advance. Registering a subname spends the organization's gas. " +
        "A label already owned by another account is refused, not taken.",
      inputSchema: createShape,
      annotations: CREATES,
    },
    async (input) => {
      /*
        A label already in the fleet is refused here, not passed through.

        The route would accept it and re-provision, because "already owned by
        another account" is the only unavailability it knows and the
        organization owning its own name is not that. Repair is a real and
        wanted behaviour — it is how a half-finished agent is finished without
        paying twice — but it is not what a caller asking to *create* something
        is asking for, and a model that retries a timed-out call would reach it
        without ever deciding to.

        So the two are separated by intent rather than by outcome: this tool
        creates, and the refusal names the screen that repairs. Read through
        the same route a client would call, so the check sees what the fleet
        actually holds rather than a copy of it.
      */
      const existing = (await (await call("/v1/agents")).json()) as {
        agents?: { slug: string; ensName: string; id: string }[];
      };
      const clash = existing.agents?.find((a) => a.slug === input.label);
      if (clash) {
        return text({
          status: "exists",
          ensName: clash.ensName,
          agentId: clash.id,
          reason:
            `${clash.ensName} is already in this fleet. Creating it again would re-run ` +
            "provisioning and rewrite its on-chain agent-context record with the name and " +
            "description sent here. Pick a different label. To finish a half-provisioned " +
            "agent, use the New agent screen, which asks before repairing.",
        });
      }

      const endpoints = {
        ...(input.mcpEndpoint && { mcp: input.mcpEndpoint }),
        ...(input.a2aEndpoint && { a2a: input.a2aEndpoint }),
      };

      const response = await call("/v1/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: input.label,
          name: input.name,
          description: input.description,
          role: input.role,
          controller: input.controller,
          endpoints,
          ...(input.delegate !== undefined && { delegate: input.delegate }),
        }),
      });

      const body = (await response.json()) as Record<string, unknown>;

      /*
        A refusal is returned as a described outcome, not thrown.

        `isError` would reach the model as "the tool broke". A label owned by
        somebody else is the product working, and the caller's next move — pick
        another label — depends on reading which owner and why. The same
        argument `docs/11` makes about rendering a denial as an error.
      */
      return text({ httpStatus: response.status, ...body });
    },
  );

  return server;
}
