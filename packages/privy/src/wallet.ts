import { serverEnv } from "@nymspace/core/env";
import type { Address } from "viem";
import {
  authorizationSignature,
  type AuthorizationKey,
} from "./authorization";
import {
  type PaymentRequest,
  type PaymentResult,
  type PolicyLimit,
} from "./policy";
import {
  BASE_SEPOLIA_USDC,
  ERC20_TRANSFER_ABI_JSON,
  erc20TransferData,
  type TokenSpec,
} from "./token";

/**
 * The server-side Privy client.
 *
 * REST rather than the SDK, for the same reason `@nymspace/graph` queries
 * through `fetch`: the surface used here is a handful of endpoints, and a
 * dependency whose version moves is one more thing to re-verify before a demo.
 * Every call is request-scoped and server-side by construction, and the
 * credentials never leave this module.
 *
 * One client, one authority. The client that sends the agent's payments holds
 * the agent's authorization key; the client that executes an approved payment
 * holds the owner's. They differ in nothing else, which is what makes the
 * escalation a difference in authority rather than a difference in code path.
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

/**
 * The agent's signing key — the one whose authority the policy caps.
 *
 * `PRIVY_AUTHORIZATION_*` keeps its name because it is the key that has always
 * been there and renaming it would strand every deployment; what changed is
 * what it means. It is now the *agent's* key, and the wallet's owner is a
 * different key entirely.
 */
export function agentSignerKey(): AuthorizationKey {
  const credentials = privyCredentials();
  return {
    keyId: credentials.authorizationKeyId,
    privateKey: credentials.authorizationPrivateKey,
  };
}

/**
 * The owner's key, if one is configured.
 *
 * Optional on purpose — design.md D6. With no owner key there is no higher
 * authority, so there is no approval path, so the product must offer none. The
 * absence of this variable is what makes that true rather than a flag someone
 * forgets to turn off.
 */
export function ownerSignerKey(): AuthorizationKey | undefined {
  const { ownerKeyId, ownerPrivateKey } = serverEnv().privy;
  if (!ownerKeyId || !ownerPrivateKey) return undefined;
  return { keyId: ownerKeyId, privateKey: ownerPrivateKey };
}

/** The token the demo pays in, or `null` for native ETH. */
export function demoToken(): TokenSpec | null {
  const demo = serverEnv().demo;
  const address = demo.paymentTokenAddress;
  if (!address) return null;
  if (address.toLowerCase() === BASE_SEPOLIA_USDC.address.toLowerCase()) {
    return BASE_SEPOLIA_USDC;
  }
  const decimals = demo.paymentTokenDecimals;
  const symbol = demo.paymentTokenSymbol;
  if (!decimals || !symbol) {
    throw new Error(
      `DEMO_PAYMENT_TOKEN_ADDRESS is ${address}, which is not the known ` +
        "Base Sepolia USDC deployment. Set DEMO_PAYMENT_TOKEN_DECIMALS and " +
        "DEMO_PAYMENT_TOKEN_SYMBOL too — an amount whose decimals are guessed " +
        "is off by orders of magnitude in the direction that still looks fine.",
    );
  }
  return {
    address: address as Address,
    symbol,
    decimals: Number(decimals),
  };
}

/** The narrow slice of Privy the product uses. */
export interface PrivyWalletPort {
  sendPayment(
    walletId: string,
    request: PaymentRequest,
  ): Promise<PaymentResult>;
}

export interface WalletSigner {
  signerId: string;
  overridePolicyIds: string[];
}

export interface PrivyWallet {
  id: string;
  address: string;
  chainType: string;
  policyIds: string[];
  /** The key quorum that owns the wallet, if any. */
  ownerId?: string;
  additionalSigners: WalletSigner[];
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

interface WalletBody {
  id: string;
  address: string;
  chain_type: string;
  policy_ids?: string[];
  owner_id?: string;
  additional_signers?: {
    signer_id: string;
    override_policy_ids?: string[];
  }[];
}

function toWallet(body: WalletBody, fallbackPolicyIds: string[] = []): PrivyWallet {
  return {
    id: body.id,
    address: body.address,
    chainType: body.chain_type,
    policyIds: body.policy_ids ?? fallbackPolicyIds,
    ...(body.owner_id && { ownerId: body.owner_id }),
    additionalSigners: (body.additional_signers ?? []).map((signer) => ({
      signerId: signer.signer_id,
      overridePolicyIds: signer.override_policy_ids ?? [],
    })),
  };
}

/** A policy as Privy returns it, before a limit is read out of it. */
interface PolicyBody {
  id: string;
  name: string;
  rules?: {
    name?: string;
    method?: string;
    action?: string;
    conditions?: {
      field_source?: string;
      field?: string;
      operator?: string;
      value?: string;
      abi?: unknown;
    }[];
  }[];
}

export interface PrivyClientOptions {
  credentials?: PrivyCredentials;
  fetchImpl?: typeof fetch;
  /**
   * The key this client acts as. Absent means app authority alone, which is
   * enough only while the wallet has no owner.
   */
  authorizationKey?: AuthorizationKey;
  /**
   * Tokens this client can denominate a limit in.
   *
   * A policy names a contract address and nothing else; the decimals have to
   * come from somewhere, and guessing them is how a six-decimal limit renders
   * as a rounding error. An address outside this list makes `getPolicyLimit`
   * throw rather than display a number in unknown units.
   */
  tokens?: TokenSpec[];
}

export class PrivyClient implements PrivyWalletPort {
  private readonly credentials: PrivyCredentials;
  private readonly fetchImpl: typeof fetch;
  private readonly authorizationKey: AuthorizationKey | undefined;
  private readonly tokens: TokenSpec[];

  constructor(options: PrivyClientOptions = {}) {
    this.credentials = options.credentials ?? privyCredentials();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.authorizationKey = options.authorizationKey;
    this.tokens = options.tokens ?? [BASE_SEPOLIA_USDC];
  }

  /** Which key this client acts as, for evidence. Never the key itself. */
  get actingKeyId(): string | undefined {
    return this.authorizationKey?.keyId;
  }

  /** The same client, acting as a different authority. */
  withKey(authorizationKey: AuthorizationKey): PrivyClient {
    return new PrivyClient({
      credentials: this.credentials,
      fetchImpl: this.fetchImpl,
      authorizationKey,
      tokens: this.tokens,
    });
  }

  private async request<T>(
    path: string,
    init: { method: string; body?: unknown } = { method: "GET" },
  ): Promise<T> {
    const { appId, appSecret } = this.credentials;
    const url = `${API}${path}`;

    const headers: Record<string, string> = {
      authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString("base64")}`,
      "privy-app-id": appId,
      "content-type": "application/json",
    };

    /**
     * GET requests are not signed — Privy does not require it, and signing a
     * body that does not exist would mean inventing one. Everything that
     * changes state is signed when a key is present, which is what lets the
     * enclave attribute the request to a signer and apply that signer's policy.
     */
    if (this.authorizationKey && init.method !== "GET") {
      headers["privy-authorization-signature"] = authorizationSignature(
        this.authorizationKey,
        {
          method: init.method,
          url,
          ...(init.body !== undefined && { body: init.body }),
          appId,
        },
      );
    }

    const response = await this.fetchImpl(url, {
      method: init.method,
      headers,
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
   * Create a wallet, optionally owned by a key quorum.
   *
   * Ownership is the decision `docs/08` asks to be recorded rather than
   * defaulted. The demo's answer: the wallet is owned by the organization's key
   * quorum, and the agent is an additional signer carrying a policy — because
   * that is the arrangement the product claims on screen, where the
   * organization grants a narrow authority and the agent acts inside it. An
   * app-owned wallet with a wallet-level policy demonstrates the same denial
   * and a weaker sentence: the application limiting itself.
   */
  async createWallet(params: {
    policyIds?: string[];
    ownerId?: string;
    additionalSigners?: WalletSigner[];
  }): Promise<PrivyWallet> {
    const body = await this.request<WalletBody>("/wallets", {
      method: "POST",
      body: {
        chain_type: "ethereum",
        ...(params.policyIds?.length && { policy_ids: params.policyIds }),
        ...(params.ownerId && { owner_id: params.ownerId }),
        ...(params.additionalSigners?.length && {
          additional_signers: params.additionalSigners.map((signer) => ({
            signer_id: signer.signerId,
            override_policy_ids: signer.overridePolicyIds,
          })),
        }),
      },
    });

    return toWallet(body, params.policyIds ?? []);
  }

  async getWallet(walletId: string): Promise<PrivyWallet> {
    return toWallet(await this.request<WalletBody>(`/wallets/${walletId}`));
  }

  async listWallets(): Promise<PrivyWallet[]> {
    const body = await this.request<{ data: WalletBody[] }>("/wallets");
    return (body.data ?? []).map((wallet) => toWallet(wallet));
  }

  /** Attach or replace the policies enforced on a wallet. */
  async setWalletPolicies(
    walletId: string,
    policyIds: string[],
  ): Promise<PrivyWallet> {
    const body = await this.request<WalletBody>(`/wallets/${walletId}`, {
      method: "PATCH",
      body: { policy_ids: policyIds },
    });
    return toWallet(body, policyIds);
  }

  /**
   * Register a P-256 public key as a key quorum, and get back its id.
   *
   * The id is what `owner_id` and `signer_id` refer to. The private half is
   * generated by the caller and never sent — `scripts/provision-wallet.ts`
   * prints it once for the operator to place in the environment, which is the
   * only moment it exists outside a key store.
   */
  async createKeyQuorum(params: {
    displayName: string;
    publicKeyDer: string;
    threshold?: number;
  }): Promise<{ id: string }> {
    return this.request<{ id: string }>("/key_quorums", {
      method: "POST",
      body: {
        display_name: params.displayName,
        public_keys: [params.publicKeyDer],
        authorization_threshold: params.threshold ?? 1,
      },
    });
  }

  /**
   * Set the wallet's owner and the signers that may act on it.
   *
   * Both in one call, because they are one decision: an owner with no
   * additional signer locks the agent out, and an additional signer on an
   * unowned wallet constrains nothing — Privy only evaluates a signer's
   * override policy when the request is signed, and an unowned wallet accepts
   * unsigned requests.
   */
  async setWalletSigners(
    walletId: string,
    params: { ownerId?: string; additionalSigners: WalletSigner[] },
  ): Promise<PrivyWallet> {
    const body = await this.request<WalletBody>(`/wallets/${walletId}`, {
      method: "PATCH",
      body: {
        ...(params.ownerId && { owner_id: params.ownerId }),
        additional_signers: params.additionalSigners.map((signer) => ({
          signer_id: signer.signerId,
          override_policy_ids: signer.overridePolicyIds,
        })),
      },
    });
    return toWallet(body);
  }

  //////////////////////////////////////////////////////////////////////////
  // Policies
  //////////////////////////////////////////////////////////////////////////

  /**
   * One rule, two conditions, one `ALLOW`.
   *
   * Privy defaults to `DENY` when nothing matches, so a lone `ALLOW` rule is a
   * whitelist rather than a filter: this signer may call `transfer` on this one
   * contract for at most this much, and may do nothing else — not a native
   * transfer, not `approve`, not a different token. A rule on the transaction's
   * `value` field says none of that, which is why the token path does not reuse
   * it.
   */
  async createTokenPolicy(params: {
    name: string;
    token: TokenSpec;
    maxAmount: bigint;
  }): Promise<PolicyLimit> {
    const ruleName = `Transfer at most ${params.maxAmount} ${params.token.symbol} base units`;

    const body = await this.request<PolicyBody>("/policies", {
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
                field: "to",
                operator: "eq",
                value: params.token.address,
              },
              {
                field_source: "ethereum_calldata",
                field: "transfer.amount",
                abi: ERC20_TRANSFER_ABI_JSON,
                operator: "lte",
                value: `0x${params.maxAmount.toString(16)}`,
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
      maxAmount: params.maxAmount.toString(10),
      token: params.token,
      ruleName,
    };
  }

  /**
   * The native-ETH control, kept for the path where no token is configured.
   *
   * `value` is hex wei because that is what the field takes and because a
   * decimal there is a silently different number.
   */
  async createAmountPolicy(params: {
    name: string;
    maxValueWei: bigint;
  }): Promise<PolicyLimit> {
    const ruleName = `Restrict native transfers to ${params.maxValueWei} wei`;

    const body = await this.request<PolicyBody>("/policies", {
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
      maxAmount: params.maxValueWei.toString(10),
      token: null,
      ruleName,
    };
  }

  /**
   * Read the live limit back from the policy — task 5.9.
   *
   * The interface displays what this returns and never a constant. A hardcoded
   * limit is right until somebody changes the policy, and then it is a lie the
   * screen tells confidently; Gate C changes the policy and requires the
   * displayed value to move.
   */
  async getPolicyLimit(policyId: string): Promise<PolicyLimit> {
    return this.readLimit(await this.request<PolicyBody>(`/policies/${policyId}`));
  }

  private readLimit(body: PolicyBody): PolicyLimit {
    for (const rule of body.rules ?? []) {
      const conditions = rule.conditions ?? [];

      const amount = conditions.find(
        (condition) =>
          condition.operator === "lte" &&
          condition.value !== undefined &&
          (condition.field === "transfer.amount" || condition.field === "value"),
      );
      if (!amount?.value) continue;

      const contract = conditions.find(
        (condition) => condition.field === "to" && condition.operator === "eq",
      );

      /**
       * A limit whose units are unknown must not be rendered.
       *
       * The policy names a contract; the decimals are ours to supply. Showing
       * `1000000` as if it were whole tokens, or as if it were wei, is the one
       * mistake here that produces a confident, wrong number on screen rather
       * than an error.
       */
      let token: TokenSpec | null = null;
      if (amount.field === "transfer.amount") {
        const address = contract?.value?.toLowerCase();
        token =
          this.tokens.find((spec) => spec.address.toLowerCase() === address) ??
          null;
        if (!token) {
          throw new PrivyError(
            `Policy ${body.id} limits transfers of ${contract?.value ?? "an unnamed contract"}, ` +
              "which this client cannot denominate. Add the token to the " +
              "client's token list — a limit displayed in unknown units is " +
              "worse than no limit displayed.",
          );
        }
      }

      return {
        policyId: body.id,
        name: body.name,
        maxAmount: BigInt(amount.value).toString(10),
        token,
        ruleName: rule.name ?? "unnamed rule",
      };
    }

    throw new PrivyError(
      `Policy ${body.id} carries no lte condition on an amount, so there is ` +
        "no limit to display. A policy that constrains nothing must not be " +
        "rendered as one that does.",
    );
  }

  /**
   * Move the limit, leaving every other condition where it was.
   *
   * Reads the policy first and rewrites one value, rather than rebuilding the
   * rules from parameters. Rebuilding is how the token condition disappears
   * during a limit change, and a policy that silently stops pinning the
   * contract still passes every assertion about the amount.
   */
  async updatePolicyLimit(
    policyId: string,
    maxAmount: bigint,
  ): Promise<PolicyLimit> {
    const current = await this.request<PolicyBody>(`/policies/${policyId}`);
    let replaced = false;

    const rules = (current.rules ?? []).map((rule) => ({
      ...rule,
      conditions: (rule.conditions ?? []).map((condition) => {
        if (
          condition.operator === "lte" &&
          (condition.field === "transfer.amount" || condition.field === "value")
        ) {
          replaced = true;
          return { ...condition, value: `0x${maxAmount.toString(16)}` };
        }
        return condition;
      }),
    }));

    if (!replaced) {
      throw new PrivyError(
        `Policy ${current.id} has no amount condition to update. Refusing to ` +
          "write rules that would replace an unknown control with this one.",
      );
    }

    await this.request(`/policies/${policyId}`, {
      method: "PATCH",
      body: { rules },
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
    /**
     * A token payment is a zero-value call to the token contract. The amount
     * lives in the calldata, which is exactly where the policy reads it from —
     * the same bytes decide the transfer and the decision about it.
     */
    const transaction = request.token
      ? {
          to: request.token.address,
          value: "0x0",
          data: erc20TransferData(
            request.recipient as Address,
            BigInt(request.amount),
          ),
        }
      : {
          to: request.recipient,
          value: `0x${BigInt(request.amount).toString(16)}`,
        };

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
          params: { transaction },
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

  /**
   * 401 stays a failure, deliberately.
   *
   * An unsigned or wrongly-signed request is not the policy refusing a
   * payment, it is the caller failing to prove who it is — and once the wallet
   * has an owner, a missing signature is the likeliest way this integration
   * breaks. Reporting it as a denial would put "the control worked" on screen
   * for a request the control never saw.
   */

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
