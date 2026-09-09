/**
 * The state machines from `docs/11_FRONTEND_STATE_MACHINE.md`.
 *
 * That document opens with the rule the whole console is built around: a policy
 * denial is not a system failure, an EAC denial is not a system failure, and
 * both are proof that the control plane works. So `denied` is a first-class
 * state in every machine here rather than a flavour of `failed`, and nothing in
 * this file lets a caller collapse the two.
 *
 * Pure — no React, no fetch. The screens import the labels; the tests import
 * the transitions.
 */

//////////////////////////////////////////////////////////////////////////////
// Identity
//////////////////////////////////////////////////////////////////////////////

export type IdentityState =
  | "idle"
  | "loading"
  | "active"
  | "partial"
  | "rpc_error";

/**
 * `partial` is the state that stops the console overclaiming.
 *
 * An ENS name that exists but has no resolver, no MCP record, or no ENSIP 25
 * binding is not `active` — rendering it as active would tell an operator the
 * agent is reachable when nothing has said so.
 */
export function identityStateFrom(identity: {
  resolver?: string | null;
  records: { mcp?: string | null; context?: string | null };
  ensip25: { status: string };
}): IdentityState {
  const zero = "0x0000000000000000000000000000000000000000";
  if (identity.ensip25.status === "rpc_error") return "rpc_error";

  const missing =
    !identity.resolver ||
    identity.resolver === zero ||
    !identity.records.mcp ||
    identity.ensip25.status !== "verified";

  return missing ? "partial" : "active";
}

//////////////////////////////////////////////////////////////////////////////
// Permission actions
//////////////////////////////////////////////////////////////////////////////

export type PermissionActionState =
  | "checking"
  | "allowed"
  | "denied"
  | "submitting"
  | "confirmed"
  | "reverted"
  | "rpc_error";

/**
 * `reverted` and `denied` are different, and the difference is the product.
 *
 * `denied` is the contract refusing an unauthorized caller — the boundary
 * holding. `reverted` is a transaction that failed for some other reason, which
 * says nothing about authority. The API decides which by decoding the revert;
 * this maps its answer without re-deciding it.
 */
export function permissionStateFrom(outcome: {
  status: string;
  reason?: string;
}): PermissionActionState {
  if (outcome.status === "confirmed") return "confirmed";
  if (outcome.status === "denied") return "denied";
  if (outcome.status === "failed") return "reverted";
  return "rpc_error";
}

//////////////////////////////////////////////////////////////////////////////
// Verification
//////////////////////////////////////////////////////////////////////////////

export type VerificationState =
  | "unchecked"
  | "checking"
  | "verified"
  | "registry_claim_missing"
  | "ens_record_missing"
  | "mismatch"
  | "rpc_error";

/**
 * What each state means to an operator, in the words the console shows.
 *
 * `docs/06` forbids collapsing these into "unverified", and the reason is
 * visible here: four of the seven say something different about the agent, and
 * one of them says nothing about the agent at all.
 */
export const VERIFICATION_LABELS: Record<
  VerificationState,
  { label: string; detail: string; tone: "good" | "warn" | "bad" | "neutral" }
> = {
  unchecked: {
    label: "Not checked",
    detail: "Verification has not been run for this agent yet.",
    tone: "neutral",
  },
  checking: {
    label: "Checking",
    detail: "Reading the registry claim and the ENS record.",
    tone: "neutral",
  },
  verified: {
    label: "Verified",
    detail:
      "The registry entry claims this name and the ENS record confirms the registration.",
    tone: "good",
  },
  registry_claim_missing: {
    label: "No registry claim",
    detail:
      "The ERC 8004 registration does not claim this ENS name, so there is nothing for ENS to confirm.",
    tone: "warn",
  },
  ens_record_missing: {
    label: "No ENS record",
    detail:
      "The registry claims this name but the ENSIP 25 record is absent. This is also where a mis-encoded key lands, so treat it as a reading rather than a verdict.",
    tone: "warn",
  },
  mismatch: {
    label: "Mismatch",
    detail: "The registration claims a different ENS name than this one.",
    tone: "bad",
  },
  rpc_error: {
    label: "Could not check",
    detail:
      "A read failed. This says nothing about the agent — only that we could not ask.",
    tone: "neutral",
  },
};

/** True when a state is a finding about the agent rather than about us. */
export function isFinding(state: VerificationState): boolean {
  return state !== "unchecked" && state !== "checking" && state !== "rpc_error";
}

//////////////////////////////////////////////////////////////////////////////
// Graph
//////////////////////////////////////////////////////////////////////////////

export type GraphState =
  | "idle"
  | "querying"
  | "results"
  | "empty"
  | "indexing_pending"
  | "provider_error";

/**
 * `empty` and `provider_error` must never render the same way.
 *
 * "No agent matched" and "we could not ask" are different answers, and a
 * console that shows an outage as an empty market is telling the operator
 * something false with complete confidence.
 */
export function graphStateFrom(result: {
  error?: string | null;
  resultCount: number;
  indexingPending?: boolean;
}): GraphState {
  if (result.error) return "provider_error";
  if (result.indexingPending) return "indexing_pending";
  return result.resultCount > 0 ? "results" : "empty";
}

//////////////////////////////////////////////////////////////////////////////
// Financial
//////////////////////////////////////////////////////////////////////////////

export type FinancialState =
  | "idle"
  | "preparing"
  | "submitting"
  | "executed"
  | "denied"
  | "pending_approval"
  | "failed";

export function financialStateFrom(result: { status: string }): FinancialState {
  switch (result.status) {
    case "executed":
      return "executed";
    case "denied":
      return "denied";
    case "pending_approval":
      return "pending_approval";
    default:
      return "failed";
  }
}

//////////////////////////////////////////////////////////////////////////////
// Loading copy
//////////////////////////////////////////////////////////////////////////////

/**
 * Loading states name the system being read — task 7.16.
 *
 * `docs/03` says never to show fake success placeholders, and a spinner over a
 * skeleton row of plausible values is exactly that: it renders content the
 * system has not returned, which the eye reads as data.
 */
export const LOADING_COPY = {
  ens: "Reading ENSv2 state",
  transaction: "Waiting for transaction",
  graph: "Waiting for Agent0 indexing",
  policy: "Evaluating wallet policy",
  discovery: "Querying Agent0 and ranking results",
} as const;
