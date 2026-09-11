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
