import { HTTPException } from "hono/http-exception";
import * as z from "zod";
import { isPublishableEndpoint, type Address } from "@nymspace/core";
import { NoSignerError, agentEndpointKey } from "@nymspace/ens";
import { isValidLabel } from "../provisioning";

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

/**
 * An amount in the token's base units, as a decimal string.
 *
 * Never a number: 2^53 is not enough for wei, and a JSON number is a float
 * before it is anything else. The unit is the *token's* base unit, which is why
 * the payment schema carries the token alongside it — `5000000` is five dollars
 * or five femto-ether depending on a field that is not this one.
 */
export const baseUnitsSchema = z
  .string()
  .regex(/^\d+$/, "must be a decimal string in the token's base units");

export const permissionGrantSchema = z.object({
  controller: addressSchema,
  recordKey: z.string().min(1),
  grant: z.boolean(),
});

/**
 * A record write, with one rule about one key.
 *
 * An MCP endpoint must be https, checked here so a local `http://localhost`
 * value is a 400 before the handler reads chain. `EnsService.writeText`
 * refuses it too, but that refusal would land in this route's `catch`, which
 * writes an `ens.action.denied` row, and a URL the API refused is not
 * something the resolver denied. An empty value is allowed: clearing the
 * record publishes no endpoint at all.
 */
export const recordWriteSchema = z
  .object({
    key: z.string().min(1),
    value: z.string(),
  })
  .refine(
    ({ key, value }) =>
      key !== agentEndpointKey("mcp") || value === "" || isPublishableEndpoint(value),
    { error: "an MCP endpoint written to ENS must be an https URL", path: ["value"] },
  );

/**
 * What `POST /v1/agents` accepts.
 *
 * Endpoints are named by protocol, never by record key. A body carrying a raw
 * key could name the ENSIP 25 binding, and `docs/02` Flow 4 is explicit that
 * the agent controller does not receive permission to rewrite it — so the keys
 * are derived server-side and this shape cannot express the dangerous request.
 *
 * `delegate` defaults to false. A fleet needs at least one name whose
 * controller holds no grant, and defaulting the other way would quietly make
 * every created agent a delegated one.
 */
export const agentCreateSchema = z.object({
  label: z
    .string()
    .refine(isValidLabel, "lowercase letters, digits and internal hyphens only"),
  name: z.string().min(1),
  description: z.string().min(1),
  role: z.string().min(1),
  controller: addressSchema,
  endpoints: z
    .object({ mcp: z.url().optional(), a2a: z.url().optional() })
    .default({}),
  delegate: z.boolean().optional().default(false),
});

/**
 * `token` is the address, matched against the configured one by the handler.
 *
 * Optional, defaulting to the configured token — but an *unrecognised* token is
 * a 400 rather than a fallback to native. `docs/10` puts the token in the
 * contract, and the previous shape accepted no token at all while
 * `PaymentRequest` declared one, so "pay 5 USDC" became "send 5 wei of ETH"
 * with no error anywhere.
 */
export const paymentSchema = z.object({
  amount: baseUnitsSchema,
  recipient: addressSchema,
  token: addressSchema.optional(),
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

/**
 * The token named in a request is not the token this deployment pays in.
 *
 * A 400 rather than a silent substitution. The failure this prevents is the one
 * the old code had: a token the client asked for, a native transfer the server
 * sent, and a success on screen for a payment nobody requested.
 */
export function unknownToken(requested: string, configured: string | null): never {
  throw new HTTPException(400, {
    message: configured
      ? `token ${requested} is not the configured payment token (${configured})`
      : `token ${requested} was requested but this deployment pays in native ETH`,
  });
}

export function walletNotProvisioned(id: string): never {
  throw new HTTPException(409, {
    message: `agent ${id} has no wallet. Run \`pnpm provision:wallet\`.`,
  });
}

/** The shape every ENS denial takes. Exported so the tests assert on it. */
export interface DeniedOutcome {
  status: "denied" | "failed" | "not_configured";
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
  const message = error instanceof Error ? error.message : String(error);
  const authorization = message.includes("EACUnauthorizedAccountRoles");

  /**
   * A write with no key never reached the resolver, so it is not a denial.
   *
   * Without this branch the two arrive at the console identically — both
   * carrying `source: "ensv2"`, separated only by `status` — and a missing
   * environment variable reads as the contract refusing the operator. They are
   * opposite facts about an agent's authority: one says it is not allowed, the
   * other says nobody asked. Detected by class rather than by the sentence,
   * because the client was matching that sentence with a regex and any
   * rewording of `NoSignerError` silently broke the classification.
   */
  if (error instanceof NoSignerError) {
    return {
      status: "not_configured",
      source: "ensv2",
      contractAddress,
      reason: "NoSignerError",
      detail: message,
      readAt: readAt(),
    };
  }

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
