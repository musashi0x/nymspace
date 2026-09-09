import { serverEnv } from "@nymspace/core/env";
import {
  previewAgainstLimit,
  type Caip2,
  type PaymentRequest,
  type PaymentResult,
  type PolicyLimit,
} from "./policy";

/**
 * The server-side Privy client.
 *
 * REST rather than the SDK, for the same reason `@nymspace/graph` queries
 * through `fetch`: the surface used here is four endpoints, and a dependency
 * whose version moves is one more thing to re-verify before a demo. Every call
 * is request-scoped and server-side by construction, and the credentials never
 * leave this module.
 */

const API = "https://api.privy.io/v1";

export interface PrivyCredentials {
  appId: string;
  appSecret: string;
  authorizationKeyId: string;
  authorizationPrivateKey: string;
  policyId?: string;
}

/**
 * Read and assert the full credential set.
 *
 * Throws naming the absent variable, per the startup-validation rule in
 * `docs/19_ENV_AND_CONFIG.md`: a financial route must not discover a missing
 * secret mid-request.
 */
export function privyCredentials(): PrivyCredentials {
  const env = serverEnv();
  const appId = process.env["NEXT_PUBLIC_PRIVY_APP_ID"];

  const missing: string[] = [];
  if (!appId) missing.push("NEXT_PUBLIC_PRIVY_APP_ID");
  if (!env.privy.appSecret) missing.push("PRIVY_APP_SECRET");
  if (!env.privy.authorizationKeyId) missing.push("PRIVY_AUTHORIZATION_KEY_ID");
  if (!env.privy.authorizationPrivateKey) {
    missing.push("PRIVY_AUTHORIZATION_PRIVATE_KEY");
  }
  if (missing.length > 0) {
    throw new Error(`Privy is not configured; missing: ${missing.join(", ")}`);
  }

  return {
    appId: appId as string,
    appSecret: env.privy.appSecret as string,
    authorizationKeyId: env.privy.authorizationKeyId as string,
    authorizationPrivateKey: env.privy.authorizationPrivateKey as string,
    policyId: env.privy.policyId,
  };
}

/** The narrow slice of Privy the product uses. */
export interface PrivyWalletPort {
  sendPayment(
    walletId: string,
    request: PaymentRequest,
  ): Promise<PaymentResult>;
}

export interface PrivyWallet {
  id: string;
  address: string;
  chainType: string;
  policyIds: string[];
}

export class PrivyError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "PrivyError";
  }
}

//////////////////////////////////////////////////////////////////////////////

export interface PrivyClientOptions {
  credentials?: PrivyCredentials;
  fetchImpl?: typeof fetch;
}

export class PrivyClient implements PrivyWalletPort {
  private readonly credentials: PrivyCredentials;
  private readonly fetchImpl: typeof fetch;

  constructor(options: PrivyClientOptions = {}) {
    this.credentials = options.credentials ?? privyCredentials();
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private headers(): Record<string, string> {
    const { appId, appSecret } = this.credentials;
    return {
      authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString("base64")}`,
      "privy-app-id": appId,
      "content-type": "application/json",
    };
  }

  private async request<T>(
    path: string,
    init: { method: string; body?: unknown } = { method: "GET" },
  ): Promise<T> {
    const response = await this.fetchImpl(`${API}${path}`, {
      method: init.method,
      headers: this.headers(),
      ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
    });

    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = text;
    }

    if (!response.ok) {
      throw new PrivyError(
        `Privy responded ${response.status}: ${text.slice(0, 300)}`,
        response.status,
        body,
      );
    }
    return body as T;
  }

  //////////////////////////////////////////////////////////////////////////
  // Wallets
  //////////////////////////////////////////////////////////////////////////

  /**
   * Create an application-owned wallet governed by a policy.
   *
   * Application-owned, which is task 5.3's decision made by trying one:
   * `docs/08` offers application-owned or user-owned-with-a-restricted-server-
   * signer and says to pick whichever reaches a working policy-controlled
   * transaction fastest. Application-owned needs no user record and no consent
   * flow, so the policy is the only thing standing between the agent and a
   * transfer — which is exactly the control being demonstrated. The trade-off
   * is recorded rather than hidden: this model gives the application full
   * signing authority, and the policy is what constrains it.
   */
  async createWallet(params: { policyIds?: string[] }): Promise<PrivyWallet> {
    const body = await this.request<{
      id: string;
      address: string;
      chain_type: string;
      policy_ids?: string[];
    }>("/wallets", {
      method: "POST",
      body: {
        chain_type: "ethereum",
        ...(params.policyIds?.length && { policy_ids: params.policyIds }),
      },
    });

    return {
      id: body.id,
      address: body.address,
      chainType: body.chain_type,
      policyIds: body.policy_ids ?? params.policyIds ?? [],
    };
  }

  async getWallet(walletId: string): Promise<PrivyWallet> {
    const body = await this.request<{
      id: string;
      address: string;
      chain_type: string;
      policy_ids?: string[];
    }>(`/wallets/${walletId}`);

    return {
      id: body.id,
      address: body.address,
      chainType: body.chain_type,
      policyIds: body.policy_ids ?? [],
    };
  }

  async listWallets(): Promise<PrivyWallet[]> {
    const body = await this.request<{
      data: { id: string; address: string; chain_type: string; policy_ids?: string[] }[];
    }>("/wallets");

    return (body.data ?? []).map((w) => ({
      id: w.id,
      address: w.address,
      chainType: w.chain_type,
      policyIds: w.policy_ids ?? [],
    }));
  }

  /** Attach or replace the policies enforced on a wallet. */
  async setWalletPolicies(
    walletId: string,
    policyIds: string[],
  ): Promise<PrivyWallet> {
    const body = await this.request<{
      id: string;
      address: string;
      chain_type: string;
      policy_ids?: string[];
    }>(`/wallets/${walletId}`, {
      method: "PATCH",
      body: { policy_ids: policyIds },
    });

    return {
      id: body.id,
      address: body.address,
      chainType: body.chain_type,
      policyIds: body.policy_ids ?? policyIds,
    };
  }

  //////////////////////////////////////////////////////////////////////////
  // Policies
  //////////////////////////////////////////////////////////////////////////

  /**
   * Exactly one amount-based control, per task 5.4.
   *
   * One rule, so there is one thing to point at when a judge asks what stopped
   * the payment. `value` is hex wei because that is what the field takes and
   * because a decimal there is a silently different number.
   */
  async createAmountPolicy(params: {
    name: string;
    maxValueWei: bigint;
  }): Promise<PolicyLimit> {
    const ruleName = `Restrict native transfers to ${params.maxValueWei} wei`;

    const body = await this.request<{ id: string; name: string }>("/policies", {
      method: "POST",
      body: {
        version: "1.0",
        name: params.name,
        chain_type: "ethereum",
        rules: [
          {
            name: ruleName,
            method: "eth_sendTransaction",
            conditions: [
              {
                field_source: "ethereum_transaction",
                field: "value",
                operator: "lte",
                value: `0x${params.maxValueWei.toString(16)}`,
              },
            ],
            action: "ALLOW",
          },
        ],
      },
    });

    return {
      policyId: body.id,
      name: body.name,
      maxValueWei: params.maxValueWei.toString(10),
      ruleName,
    };
  }

  /**
   * Read the live limit back from the policy — task 5.9.
   *
   * The interface displays what this returns and never a constant. A hardcoded
   * limit is right until somebody changes the policy, and then it is a lie the
   * screen tells confidently; Gate C assertion 5 changes the policy and requires
   * the displayed value to move.
   */
  async getPolicyLimit(policyId: string): Promise<PolicyLimit> {
    const body = await this.request<{
      id: string;
      name: string;
      rules: {
        name?: string;
        method?: string;
        conditions?: {
          field_source?: string;
          field?: string;
          operator?: string;
          value?: string;
        }[];
      }[];
    }>(`/policies/${policyId}`);

    for (const rule of body.rules ?? []) {
      for (const condition of rule.conditions ?? []) {
        if (
          condition.field === "value" &&
          condition.operator === "lte" &&
          condition.value
        ) {
          return {
            policyId: body.id,
            name: body.name,
            maxValueWei: BigInt(condition.value).toString(10),
            ruleName: rule.name ?? "unnamed rule",
          };
        }
      }
    }

    throw new PrivyError(
      `Policy ${policyId} carries no lte condition on value, so there is no limit to display. ` +
        "A policy that constrains nothing must not be rendered as one that does.",
    );
  }

  /** Replace the amount limit on an existing policy. Gate C assertion 4. */
  async updateAmountPolicy(
    policyId: string,
    maxValueWei: bigint,
  ): Promise<PolicyLimit> {
    const ruleName = `Restrict native transfers to ${maxValueWei} wei`;

    await this.request(`/policies/${policyId}`, {
      method: "PATCH",
      body: {
        rules: [
          {
            name: ruleName,
            method: "eth_sendTransaction",
            conditions: [
              {
                field_source: "ethereum_transaction",
                field: "value",
                operator: "lte",
                value: `0x${maxValueWei.toString(16)}`,
              },
            ],
            action: "ALLOW",
          },
        ],
      },
    });

    return this.getPolicyLimit(policyId);
  }

  //////////////////////////////////////////////////////////////////////////
  // Payments
  //////////////////////////////////////////////////////////////////////////

  /**
   * Send a payment, and normalise every outcome into a typed result.
   *
   * Nothing here throws for a denial. `docs/11` is explicit that an enforced
   * policy rejecting a transfer is the control plane working, and a thrown
   * error would send it up the same path as a network fault.
   */
  async sendPayment(
    walletId: string,
    request: PaymentRequest,
  ): Promise<PaymentResult> {
    try {
      // The hash is nested under `data`, alongside the transaction request
      // Privy actually built. Reading it from the top level returns undefined
      // and normalises to `failed` — a successful payment reported as a broken
      // one, which is the mirror of the mistake this file works hardest to
      // avoid in the other direction.
      const body = await this.request<{
        method?: string;
        data?: { hash?: string; transaction_id?: string };
      }>(`/wallets/${walletId}/rpc`, {
        method: "POST",
        body: {
          method: "eth_sendTransaction",
          caip2: request.caip2,
          params: {
            transaction: {
              to: request.recipient,
              value: `0x${BigInt(request.amount).toString(16)}`,
            },
          },
        },
      });

      const hash = body.data?.hash;
      const requestId = body.data?.transaction_id;

      if (!hash) {
        return {
          status: "failed",
          reason: "Privy accepted the request but returned no transaction hash",
          ...(requestId && { requestId }),
        };
      }
      return {
        status: "executed",
        transactionHash: hash,
        ...(requestId && { requestId }),
      };
    } catch (error) {
      return normalisePrivyError(error);
    }
  }
}

//////////////////////////////////////////////////////////////////////////////
// Error normalisation — task 5.8
//////////////////////////////////////////////////////////////////////////////

/**
 * Turn a provider failure into one of the four outcomes.
 *
 * The distinction that matters is `denied` versus `failed`. A denial means the
 * policy did its job; a failure means something is broken. Getting this mapping
 * wrong in either direction is expensive: a denial reported as a failure hides
 * the product's central proof, and a failure reported as a denial claims a
 * control worked when it did not run.
 *
 * Privy signals a policy rejection with 403 and a message naming the policy, so
 * the mapping keys on the status first and the message second — a message match
 * alone would misclassify any 500 whose body happened to contain the word.
 */
export function normalisePrivyError(error: unknown): PaymentResult {
  if (!(error instanceof PrivyError)) {
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const body = error.body as
    | { error?: string; message?: string; cause?: string; policy_id?: string }
    | undefined;
  const message = body?.message ?? body?.error ?? error.message;

  if (error.status === 403) {
    return {
      status: "denied",
      reason: message,
      ...(body?.policy_id && { policyId: body.policy_id }),
    };
  }

  // Some deployments answer a policy rejection with 400 and name it in the
  // body. Matched narrowly, so an ordinary validation error stays a failure.
  if (
    error.status === 400 &&
    /polic(y|ies)|denied|not allowed|violat/i.test(message)
  ) {
    return {
      status: "denied",
      reason: message,
      ...(body?.policy_id && { policyId: body.policy_id }),
    };
  }

  return { status: "failed", reason: message };
}

export { previewAgainstLimit };
