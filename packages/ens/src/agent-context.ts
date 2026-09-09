/**
 * The `agent-context` record.
 *
 * ENSIP 26 defines the key and says the value is free text. `docs/06` wants
 * something a reader can act on, so this is JSON with a declared shape — but
 * the shape is ours, not a standard's, and this file is the only place that
 * claim is made. A consumer that cannot parse it should fall back to showing
 * the raw string rather than treating the record as absent.
 *
 * Kept deliberately small. Every field here is written from the organization
 * key and costs calldata on every update, and anything an agent might want to
 * change often belongs in its own record where a record-scoped grant can reach
 * it without handing over the whole context.
 */

export interface AgentContext {
  /** Schema marker, so a reader can tell our shape from arbitrary text. */
  schema: "nymspace/agent-context@1";
  /** Human-readable name, e.g. "Research". */
  name: string;
  /** One sentence on what the agent does. */
  description: string;
  /** The organization operating the agent, as an ENS name. */
  operator: string;
  /**
   * What the agent is allowed to do, in prose, for a human reader.
   *
   * Deliberately not a permission list. Permissions are answered by `hasRoles`
   * on the resolver, and a copy of them written into a text record would be a
   * second source of truth that goes stale the moment a grant is revoked —
   * precisely the thing this product argues against. This is a description of
   * intent; the console reads authority from chain.
   */
  role: string;
  /** ISO 8601, when this context was last written. */
  updatedAt: string;
}

export interface BuildAgentContextParams {
  name: string;
  description: string;
  operator: string;
  role: string;
  updatedAt?: string;
}

export function buildAgentContext(
  params: BuildAgentContextParams,
): AgentContext {
  return {
    schema: "nymspace/agent-context@1",
    name: params.name,
    description: params.description,
    operator: params.operator,
    role: params.role,
    updatedAt: params.updatedAt ?? new Date().toISOString(),
  };
}

/** Serialise for `setText`. Compact — every byte is calldata. */
export function encodeAgentContext(context: AgentContext): string {
  return JSON.stringify(context);
}

/**
 * Parse a record value.
 *
 * Returns undefined rather than throwing for anything that is not our shape,
 * because the record is free text by the standard and a name we do not control
 * may hold something else entirely. An unparseable context is not an error.
 */
export function decodeAgentContext(value: string): AgentContext | undefined {
  if (value.length === 0) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<AgentContext>;
    return parsed.schema === "nymspace/agent-context@1"
      ? (parsed as AgentContext)
      : undefined;
  } catch {
    return undefined;
  }
}
