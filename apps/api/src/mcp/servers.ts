import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FLEET, type FleetAgent } from "@nymspace/core";

/**
 * The fleet's own MCP servers — one per agent, answered from public facts.
 *
 * These exist so the endpoint each agent publishes in `agent-endpoint[mcp]`
 * names something that completes a handshake. Before them the record pointed
 * at a reserved `.example` host, which made the most carefully authorized
 * write in the product a write of a dead URL.
 *
 * Nothing here may reach authority. This file imports nothing from `../deps`,
 * and the route that mounts it refuses to run if dependencies are present on
 * its context (see `routes/agent-mcp.ts`). Every tool is read-only and answers
 * from `FLEET`, which holds names and descriptions and nothing a key could
 * sign. Design D1 and D4 of `connect-to-agent-mcp-endpoints`.
 */

const VERSION = "0.1.0";

/** Every tool here is a lookup. Said to the client, not only to the reader. */
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function ensName(agent: FleetAgent, parentName: string): string {
  return `${agent.label}.${parentName}`;
}

function text(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

/**
 * A fresh server for one request.
 *
 * Built per request rather than cached: the transport is stateless and the SDK
 * refuses to reuse one across requests, and a server holds its transport. The
 * tool set is two entries, so construction costs nothing worth keeping.
 */
export function createAgentServer(
  agent: FleetAgent,
  parentName: string,
): McpServer {
  const name = ensName(agent, parentName);

  // `serverInfo.name` is the full ENS name, so a client that connects can
  // compare what the server says it is with the name that published the URL.
  // That comparison is a consistency signal and never a verification: this
  // server could report any name at all (design D7).
  const server = new McpServer({ name, version: VERSION });

  server.registerTool(
    "describe_agent",
    {
      title: `Describe ${name}`,
      description: `Who ${name} is and what it is for, as the organization publishes it. Read-only.`,
      annotations: READ_ONLY,
    },
    () =>
      text({
        ensName: name,
        label: agent.label,
        name: agent.name,
        description: agent.description,
        role: agent.role,
        access: "read-only",
        ...(agent.mcpNote ? { note: agent.mcpNote } : {}),
      }),
  );

  // Only the research agent lists the fleet: discovery is its job, and the
  // other two have no reason to answer for their siblings.
  if (agent.label === "research") {
    server.registerTool(
      "list_fleet",
      {
        title: "List the fleet",
        description: `Every agent under ${parentName}, with its ENS name and role. Read-only.`,
        annotations: READ_ONLY,
      },
      () =>
        text(
          FLEET.map((member) => ({
            ensName: ensName(member, parentName),
            label: member.label,
            name: member.name,
            role: member.role,
          })),
        ),
    );
  }

  return server;
}
