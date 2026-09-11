/**
 * Where a fleet agent's MCP server lives, derived from one configured origin.
 *
 * Pure, so it sits in the unguarded root export: the permission proof in the
 * browser has to propose the same value the provisioning script writes to
 * chain, and two derivations would drift the first time one of them grew a
 * path prefix.
 *
 * The path is absolute on purpose. A relative `/mcp/<label>` resolved against
 * the base discards the base's own path, query and fragment, so `https://x`,
 * `https://x/` and `https://x/?y=1` all publish the same endpoint. That
 * matters more than it would for an ordinary link: the endpoint is an ENS
 * record, and changing it costs a transaction and an entry in the activity
 * trail.
 */

/** A DNS label, which is what a fleet agent's slug is. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function agentMcpEndpoint(base: string, label: string): string {
  if (!LABEL.test(label)) {
    throw new Error(`not an agent label: ${JSON.stringify(label)}`);
  }
  return new URL(`/mcp/${label}`, base).toString();
}

/**
 * Whether a value may be published as an agent's MCP endpoint.
 *
 * `https` and nothing else. The endpoint is written to ENS and read by anyone,
 * so an `http` value advertises a server any network in between can rewrite,
 * and a `localhost` one advertises a developer's laptop — which is exactly
 * what `AGENT_MCP_BASE_URL` is in a local `.env`. Every path that writes the
 * record asks this before it builds a transaction.
 */
export function isPublishableEndpoint(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * A value refused by {@link isPublishableEndpoint}. Named so a caller can tell
 * a URL this code refused from a write the resolver reverted.
 */
export class UnpublishableEndpointError extends Error {
  readonly endpoint: string;

  constructor(endpoint: string, remedy?: string) {
    super(
      `Refusing to publish ${endpoint}: an MCP endpoint written to ENS must be https.${remedy ? ` ${remedy}` : ""}`,
    );
    this.name = "UnpublishableEndpointError";
    this.endpoint = endpoint;
  }
}

/**
 * The endpoint a script may write to chain for a fleet agent, or an error that
 * says why not.
 *
 * For the provisioning and registration scripts, which read the base from the
 * environment and must refuse before they spend anything rather than after a
 * transaction has already been built around a local URL.
 */
export function publishableAgentMcpEndpoint(
  base: string | undefined,
  label: string,
): string {
  if (!base) {
    throw new Error(
      "AGENT_MCP_BASE_URL is not set. It is the origin every fleet agent's MCP endpoint is derived from.",
    );
  }
  const endpoint = agentMcpEndpoint(base, label);
  if (!isPublishableEndpoint(endpoint)) {
    throw new UnpublishableEndpointError(
      endpoint,
      "Point AGENT_MCP_BASE_URL at the deployed API.",
    );
  }
  return endpoint;
}
