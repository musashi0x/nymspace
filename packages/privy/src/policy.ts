/**
 * Policy types for the demo's allowed and denied payments.
 *
 * The denial path is a product feature, not a failure — docs/11_FRONTEND_STATE_MACHINE.md.
 * So a denial is a typed result rather than a thrown error, and the caller
 * renders it.
 */

export type PolicyDecision =
  | { allowed: true }
  | { allowed: false; reason: string; policyId?: string };

export interface PaymentRequest {
  /** Amount in the token's smallest unit, as a decimal string. */
  amount: string;
  tokenAddress: string;
  recipient: string;
}

/** The outcome of an attempted payment, including a policy denial. */
export type PaymentResult =
  | { status: "sent"; transactionHash: string }
  | { status: "denied"; reason: string }
  | { status: "failed"; reason: string };
