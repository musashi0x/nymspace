/**
 * The error taxonomy from `docs/03_UX_SPEC.md`.
 *
 * Four categories, and the point of separating them is that two are not errors
 * at all. "Blocked by identity policy" and "Blocked by financial policy" are
 * the control plane working — the product's central proof — and rendering them
 * in the same red box as an RPC timeout would tell the operator the system
 * broke at the exact moment it worked.
 *
 * So `tone` is not decoration. `proof` means a control refused something and
 * that is the intended outcome; `fault` means something is wrong; `waiting`
 * means somebody else has not finished.
 */

export type ErrorKind =
  | "identity_policy"
  | "financial_policy"
  | "rpc_unavailable"
  | "indexing_pending"
  | "provider_error"
  | "not_configured"
  | "unknown";

export interface ConsoleError {
  kind: ErrorKind;
  /** The headline, in the words `docs/03` specifies. */
  title: string;
  detail: string;
  tone: "proof" | "fault" | "waiting";
  /** What the operator can do, when there is anything. */
  action?: string;
}

export const ERROR_COPY: Record<ErrorKind, Omit<ConsoleError, "detail">> = {
  identity_policy: {
    kind: "identity_policy",
    title: "Blocked by identity policy",
    tone: "proof",
    action: "This is the ENSv2 resolver refusing an unauthorized write.",
  },
  financial_policy: {
    kind: "financial_policy",
    title: "Blocked by financial policy",
    tone: "proof",
    action: "No funds moved. The payment never reached a chain.",
  },
  rpc_unavailable: {
    kind: "rpc_unavailable",
    title: "Sepolia RPC unavailable",
    tone: "fault",
    action: "Retry. Nothing about the agent has been established either way.",
  },
  indexing_pending: {
    kind: "indexing_pending",
    title: "ERC 8004 registration exists but is not indexed yet",
    tone: "waiting",
    action: "The registration transaction is the evidence until the index catches up.",
  },
  provider_error: {
    kind: "provider_error",
    title: "Discovery provider unavailable",
    tone: "fault",
    action: "This is not an empty market — the query never reached the subgraph.",
  },
  /**
   * The fallback, worded so it still says something true.
   *
   * The generic apologies this replaces are the shape `docs/03` and task #88
   * both rule out: they tell the operator nothing they did not already know
   * from the box being there, and they read identically whether the agent was
   * refused, the RPC timed out, or a bug threw. This says which of those it is
   * *not* — the classifier did not recognise it, so no verdict about the
   * agent should be read into it.
   */
  /**
   * A capability this deployment does not have, which is not a fault of the
   * agent, the chain, or the operator.
   *
   * It gets its own kind because the fallback was calling it unrecognised
   * while the API was returning a 503 that named the exact variable to set.
   * "We do not know what happened" and "you have not configured writes" are
   * different sentences, and only one of them is actionable.
   */
  not_configured: {
    kind: "not_configured",
    title: "Writes are not configured",
    tone: "waiting",
    action: "Nothing was attempted on chain, so no authority was tested.",
  },
  unknown: {
    kind: "unknown",
    title: "Unrecognised failure",
    tone: "fault",
    action:
      "This was not classified as a policy denial, so it says nothing about the agent's authority. The raw response is above.",
  },
};

/**
 * Classify an API outcome.
 *
 * Keys on the structured fields the API already returns rather than on message
 * text: the API decodes the revert and names the policy, so re-deriving that
 * here from a string would be a second classifier free to disagree with the
 * first.
 */
export function classify(outcome: {
  status?: string;
  source?: string;
  reason?: string;
  error?: string;
  /** Present when the API knows what the operator must change. */
  remedy?: string;
}): ConsoleError {
  const detail = outcome.reason ?? outcome.error ?? "";

  // Checked before the denial cases: a deployment with no signing key never
  // reached a contract, so nothing it returns is a verdict about authority.
  if (outcome.remedy || /no signing key|not configured/i.test(detail)) {
    return {
      ...ERROR_COPY.not_configured,
      detail,
      ...(outcome.remedy && { action: outcome.remedy }),
    };
  }

  if (outcome.status === "denied" && outcome.source === "ensv2") {
    return { ...ERROR_COPY.identity_policy, detail };
  }
  if (outcome.status === "denied") {
    return { ...ERROR_COPY.financial_policy, detail };
  }
  if (outcome.status === "indexing_pending") {
    return { ...ERROR_COPY.indexing_pending, detail };
  }
  if (/rpc|timed out|ECONN|unreachable/i.test(detail)) {
    // An RPC fault must never be shown as a denial: one says the agent is not
    // allowed, the other says we could not ask.
    return { ...ERROR_COPY.rpc_unavailable, detail };
  }
  if (/subgraph|provider|indexer/i.test(detail)) {
    return { ...ERROR_COPY.provider_error, detail };
  }
  return { ...ERROR_COPY.unknown, detail };
}

/**
 * Empty-state copy, from `docs/03`.
 *
 * Each one explains rather than shrugs, and the last is a rule as much as a
 * string: no disabled fake balance, because a greyed-out number reads as a
 * number.
 */
export const EMPTY_STATES = {
  noAgents: {
    title: "No agents yet",
    detail: "Create your first agent identity under your ENSv2 namespace.",
  },
  noGraphMatch: {
    title: "No live Agent0 result matched this request.",
    detail: "The subgraph answered; nothing it returned fits these criteria.",
    action: "Search all MCP agents",
  },
  noWallet: {
    title: "Financial authority has not been configured for this agent.",
    detail: "No wallet, no policy, and therefore no balance to show.",
  },
  noValidation: {
    title: "Validation unavailable",
    detail:
      "No ValidationRegistry is deployed on this network. This agent has not been validated either way — it has not scored zero.",
  },
} as const;
