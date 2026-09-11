/**
 * Configuration local to the API process. Everything shared with the web app
 * lives in `@nymspace/core`; only the values that describe *this* server are
 * read here.
 */

function requireOne(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export interface ApiConfig {
  port: number;
  /** Origins allowed to call this API from a browser. */
  allowedOrigins: string[];
  /**
   * The parent ENS name the fleet lives under, e.g. `nymspace.eth`, which is
   * what each agent's MCP server reports as its identity.
   *
   * Optional, and read here rather than through `deps`, because the MCP routes
   * are mounted without dependencies on purpose. Absent, those routes answer
   * 503 and nothing else is affected: `/health` must not start failing because
   * a deployment has not been given a parent name.
   */
  agentParentName?: string;
  /**
   * `AGENT_MCP_BASE_URL`: the origin the fleet's MCP servers are published
   * under, and the one origin the outbound guard exempts from its scheme and
   * address rules, so a local API can connect to its own servers. Absent,
   * nothing is exempt.
   */
  agentMcpBaseUrl?: string;
}

export function apiConfig(): ApiConfig {
  /**
   * `API_PORT` first so a developer's `.env` keeps deciding locally, then
   * `PORT`, which is what a platform injects — Railway assigns it per
   * deployment and a process that ignores it never receives traffic.
   */
  const port = Number(process.env.API_PORT ?? process.env.PORT ?? 3112);
  if (!Number.isSafeInteger(port) || port <= 0) {
    throw new Error(`API_PORT must be a positive integer, got: ${port}`);
  }

  const parentLabel = process.env.ENSV2_PARENT_LABEL;

  return {
    port,
    allowedOrigins: requireOne("WEB_ORIGIN")
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    // The same derivation `buildDeps()` uses for `parentName`.
    ...(parentLabel ? { agentParentName: `${parentLabel}.eth` } : {}),
    ...(process.env.AGENT_MCP_BASE_URL
      ? { agentMcpBaseUrl: process.env.AGENT_MCP_BASE_URL }
      : {}),
  };
}
