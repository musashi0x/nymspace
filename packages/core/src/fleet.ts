/**
 * The fleet, as public facts: who each agent is and what it is for.
 *
 * Here rather than in the provisioning script because two things now need it
 * and they must say the same thing. The script writes `agent-context` from it,
 * and each agent's MCP server answers `describe_agent` from it — and a server
 * describing its agent differently from the record on chain would be the
 * console's own agents contradicting their own identity.
 *
 * Nothing here is a secret or a permission. What an agent may *do* is read
 * from the resolver and the wallet policy on every request; this file only
 * says what it is called and what it is meant to be.
 */

export interface FleetAgent {
  /** The subname label, e.g. `research` for `research.<parent>.eth`. */
  label: string;
  name: string;
  description: string;
  role: string;
  /**
   * Said by the agent's MCP server alongside its description, for an agent
   * whose job invites a question the server should answer before it is asked.
   */
  mcpNote?: string;
}

/** Three agents, per ADR 008. Only `research` is delegated to. */
export const FLEET: readonly FleetAgent[] = [
  {
    label: "research",
    name: "Research",
    description: "Finds and ranks other agents from live registry data.",
    role: "Reads discovery data and may update its own MCP endpoint record.",
  },
  {
    label: "trader",
    name: "Trader",
    description: "Executes payments inside a policy it cannot change.",
    role: "Holds a wallet under an amount-based policy. No record delegation.",
    mcpNote:
      "This MCP server cannot move funds. Payments go through the organization's policy-bound signer, never through a tool here.",
  },
  {
    label: "deploy",
    name: "Deploy",
    description: "Provisions and retires agents on behalf of the organization.",
    role: "Reserved. First on the cut list in docs/14.",
  },
];

export function fleetAgent(label: string): FleetAgent | undefined {
  return FLEET.find((agent) => agent.label === label);
}
