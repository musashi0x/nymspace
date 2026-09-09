import { HTTPException } from "hono/http-exception";
import * as z from "zod";
import type { Address, Hex } from "@nymspace/core";
import { NoSignerError } from "@nymspace/ens";

/**
 * Schemas and helpers shared by the product routes.
 *
 * Small on purpose: the interesting decisions belong in the packages, and the
 * only things that genuinely repeat across handlers are the read time, the
 * shapes, and the form a denial takes.
 */

/** A 20-byte address, branded so a validated value carries the type. */
export const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 20-byte address")
  .transform((value) => value as Address);

/** Wei as a decimal string. Never a number — 2^53 is not enough for wei. */
export const weiSchema = z
  .string()
  .regex(/^\d+$/, "must be a decimal string in wei");

export const permissionGrantSchema = z.object({
  controller: addressSchema,
  recordKey: z.string().min(1),
  grant: z.boolean(),
});

/**
 * What the browser reports back after its wallet broadcast a prepared grant.
 * The hash is a claim; the route verifies it against a receipt before writing
 * anything to the log.
 */
export const permissionConfirmSchema = permissionGrantSchema.extend({
  txHash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "txHash must be a 32-byte hash")
    .transform((value) => value as Hex),
  /** The account that signed, for the activity record. */
  signer: addressSchema,
});

export const recordWriteSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
});

export const paymentSchema = z.object({
  amount: weiSchema,
  recipient: addressSchema,
  memo: z.string().optional(),
});

export const discoverSchema = z.object({
  query: z.string().min(1),
  requireMcp: z.boolean().optional().default(true),
  trustModels: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(250).optional().default(100),
  refresh: z.boolean().optional().default(false),
});

export const activityFilterSchema = z.object({
  agent: z.string().optional(),
  source: z.enum(["ens", "erc8004", "graph", "privy", "app"]).optional(),
  type: z.string().optional(),
  status: z.enum(["pending", "success", "denied", "failed"]).optional(),
  limit: z.coerce.number().int().positive().max(500).optional().default(100),
});

export const permissionQuerySchema = z.object({
  controller: addressSchema.optional(),
});

//////////////////////////////////////////////////////////////////////////////

/**
 * The moment a payload was true.
 *
 * A function rather than an inline `new Date()` so that "every externally
 * derived response carries a read time" is one grep away from being audited —
 * task 6.11 tests that a payload without one fails.
 */
export function readAt(): string {
  return new Date().toISOString();
}

/**
 * A missing agent is an HTTP 404, thrown rather than returned.
 *
 * Thrown, so it stays out of the RPC response union: a client destructuring a
 * successful body should not have to narrow past an error shape on every call.
 * `app.onError` turns it into the response.
 */
export function agentNotFound(id: string): never {
  throw new HTTPException(404, { message: `agent ${id} not found` });
}

export function walletNotProvisioned(id: string): never {
  throw new HTTPException(409, {
    message: `agent ${id} has no wallet. Run \`pnpm provision:wallet\`.`,
  });
}

/** The shape every ENS denial takes. Exported so the tests assert on it. */
export interface DeniedOutcome {
  status: "denied" | "failed";
  source: "ensv2";
  contractAddress: Address;
  reason: string;
  detail: string;
  readAt: string;
}

/**
 * The resolver's own refusal, as a described outcome.
 *
 * Returned with a 200 and never thrown, which is the one place this file
 * deliberately departs from HTTP convention. An authorization denial is the
 * control plane working — `docs/11` — and an error status would put it on the
 * same path as an outage, so the product's central proof would reach the
 * console as a crash.
 *
 * The revert is decoded rather than passed through: `EACUnauthorizedAccountRoles`
 * means the boundary held, and anything else means the call failed for a reason
 * that has nothing to do with authority.
 */
export function describeDenial(
  error: unknown,
  contractAddress: Address,
): DeniedOutcome {
  // A missing signing key is a configuration state, not something the contract
  // said. Describing it here would report `source: "ensv2"` for a call that
  // never reached the chain — an infrastructure failure dressed as a
  // permission verdict, which is the one thing this shape must never do.
  // Rethrown so the error handler can answer 503 with the remedy.
  if (error instanceof NoSignerError) throw error;

  const message = error instanceof Error ? error.message : String(error);
  const authorization = message.includes("EACUnauthorizedAccountRoles");

  return {
    status: authorization ? "denied" : "failed",
    source: "ensv2",
    contractAddress,
    reason: authorization
      ? "EACUnauthorizedAccountRoles"
      : (message.split("\n")[0] ?? "unknown"),
    detail: message.split("\n").slice(0, 3).join(" "),
    readAt: readAt(),
  };
}
