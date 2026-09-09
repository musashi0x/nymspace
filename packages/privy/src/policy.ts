/**
 * Policy and payment types.
 *
 * A denial is a typed result, never a thrown error — design.md D6. `docs/11`
 * gives the reason: an enforced policy rejecting a payment is not a system
 * failure, it is proof the control plane works, and a product that throws on it
 * renders its own strongest evidence as a stack trace.
 */

/** Chain ids the demo transacts on, as CAIP-2. */
export type Caip2 = `eip155:${number}`;

export interface PaymentRequest {
  /** Amount in wei, as a decimal string. */
  amount: string;
  recipient: string;
  caip2: Caip2;
  /** Absent for a native transfer. */
  tokenAddress?: string;
  /** Free text the operator attached. The research agent's "task". */
  memo?: string;
}

/**
 * The four outcomes, per `docs/10_API_CONTRACT.md`.
 *
 * `denied` and `failed` are separate because they mean opposite things about
 * the system: a denial is the policy working, a failure is something broken.
 * Collapsing them would make the demo's central proof indistinguishable from a
 * bug, which is the failure mode `docs/11` exists to prevent.
 *
 * `pending_approval` is modelled and never produced. `docs/08` forbids
 * simulating an approval system that is not implemented, so nothing in this
 * change returns it — but the type exists so a caller's exhaustive switch keeps
 * compiling when it does.
 */
export type PaymentResult =
  | { status: "executed"; transactionHash: string; requestId?: string }
  | {
      status: "denied";
      /** The provider's own words, not ours. */
      reason: string;
      policyId?: string;
      requestId?: string;
    }
  | { status: "pending_approval"; requestId: string }
  | { status: "failed"; reason: string; requestId?: string };

/** The live policy, as the interface must read it. */
export interface PolicyLimit {
  policyId: string;
  name: string;
  /** Maximum transfer value in wei, as a decimal string. */
  maxValueWei: string;
  /** The rule the limit was read from, for the evidence drawer. */
  ruleName: string;
}

/**
 * Whether a request would exceed a limit.
 *
 * A preview, and explicitly not an authority. The policy is enforced by Privy
 * on the signing path; this only lets the interface say what it expects before
 * the operator commits. Task 5.12 tampers with the displayed value precisely to
 * prove that this function's answer changes nothing about the outcome.
 */
export function previewAgainstLimit(
  request: PaymentRequest,
  limit: PolicyLimit,
): { withinLimit: boolean; requestedWei: string; limitWei: string } {
  return {
    withinLimit: BigInt(request.amount) <= BigInt(limit.maxValueWei),
    requestedWei: request.amount,
    limitWei: limit.maxValueWei,
  };
}
