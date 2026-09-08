import { serverEnv } from "@nymspace/core/env";
import type { PaymentRequest, PaymentResult } from "./policy";

/**
 * The server-side Privy client.
 *
 * The authorization key signs wallet actions, so every call in here is
 * request-scoped and server-side by construction. The concrete Privy SDK is
 * wired on Day 3; this is the boundary those calls sit behind, so that the
 * route handler never touches a secret directly.
 */

export interface PrivyCredentials {
  appId: string;
  appSecret: string;
  authorizationKeyId: string;
  authorizationPrivateKey: string;
  policyId?: string;
}

/**
 * Read and assert the full credential set. Throws naming the absent variable,
 * per the startup-validation rule in docs/19_ENV_AND_CONFIG.md: a financial
 * route must not discover a missing secret mid-request.
 */
export function privyCredentials(): PrivyCredentials {
  const env = serverEnv();
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  const missing: string[] = [];
  if (!appId) missing.push("NEXT_PUBLIC_PRIVY_APP_ID");
  if (!env.privy.appSecret) missing.push("PRIVY_APP_SECRET");
  if (!env.privy.authorizationKeyId) missing.push("PRIVY_AUTHORIZATION_KEY_ID");
  if (!env.privy.authorizationPrivateKey) {
    missing.push("PRIVY_AUTHORIZATION_PRIVATE_KEY");
  }
  if (missing.length > 0) {
    throw new Error(
      `Privy is not configured; missing: ${missing.join(", ")}`,
    );
  }

  return {
    appId: appId as string,
    appSecret: env.privy.appSecret as string,
    authorizationKeyId: env.privy.authorizationKeyId as string,
    authorizationPrivateKey: env.privy.authorizationPrivateKey as string,
    policyId: env.privy.policyId,
  };
}

/** The narrow slice of the Privy server SDK the product uses. */
export interface PrivyWalletPort {
  sendTransaction(request: PaymentRequest): Promise<PaymentResult>;
}
