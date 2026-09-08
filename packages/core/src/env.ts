import "server-only";

import { optional, requireAll } from "./env.shared";

/**
 * The server environment surface. Guarded by `server-only`, so importing this
 * module from a client component is a build error rather than a bundle
 * containing `PRIVY_APP_SECRET`.
 *
 * Required values fail on first read with a message naming the variable, per
 * docs/19_ENV_AND_CONFIG.md: a missing variable must not be discovered during
 * the demo.
 */

/**
 * `ENSV2_PARENT_REGISTRY_ADDRESS` and `ENSV2_PERMISSIONED_RESOLVER_ADDRESS`
 * are deliberately not here. Both are proxies the Day 1 spike deploys, so they
 * are legitimately empty until it runs and requiring them would make the spike
 * unable to bootstrap the very values it produces. `@nymspace/ens`'s
 * `requireDeployed()` fails on them at the top of a route instead, which keeps
 * the "never discovered mid-transaction" rule without the ordering problem.
 */
const REQUIRED = [
  "SEPOLIA_RPC_URL",
  "ENSV2_ETH_REGISTRY_ADDRESS",
  "ENSV2_VERIFIABLE_FACTORY_ADDRESS",
] as const;

export interface ServerEnv {
  sepoliaRpcUrl: string;
  ensv2: {
    rootRegistry?: string;
    ethRegistry: string;
    ethRegistrar?: string;
    verifiableFactory: string;
    userRegistryImpl?: string;
    permissionedResolverImpl?: string;
    paymentToken?: string;
    universalResolver?: string;
    /** Deployed by the spike. Empty until it has run. */
    parentLabel?: string;
    /** Deployed by the spike. Empty until it has run. */
    parentRegistry?: string;
    /** Deployed by the spike. Empty until it has run. */
    permissionedResolver?: string;
  };
  erc8004: {
    identityRegistry?: string;
    reputationRegistry?: string;
    validationRegistry?: string;
  };
  graph: {
    apiKey?: string;
    agent0SepoliaSubgraphId?: string;
    agent0BaseSepoliaSubgraphId?: string;
  };
  privy: {
    appSecret?: string;
    authorizationKeyId?: string;
    authorizationPrivateKey?: string;
    policyId?: string;
  };
  demo: {
    allowedPaymentAmount?: string;
    deniedPaymentAmount?: string;
    paymentTokenAddress?: string;
    paymentRecipient?: string;
  };
}

let cached: ServerEnv | undefined;

/**
 * Validated server configuration. Call it at the top of a route handler or a
 * script; the first call validates and every later call is free.
 */
export function serverEnv(): ServerEnv {
  if (cached) return cached;

  const source = process.env;
  const required = requireAll(source, REQUIRED);

  cached = {
    sepoliaRpcUrl: required.SEPOLIA_RPC_URL,
    ensv2: {
      rootRegistry: optional(source, "ENSV2_ROOT_REGISTRY_ADDRESS"),
      ethRegistry: required.ENSV2_ETH_REGISTRY_ADDRESS,
      ethRegistrar: optional(source, "ENSV2_ETH_REGISTRAR_ADDRESS"),
      verifiableFactory: required.ENSV2_VERIFIABLE_FACTORY_ADDRESS,
      userRegistryImpl: optional(source, "ENSV2_USER_REGISTRY_IMPL_ADDRESS"),
      permissionedResolverImpl: optional(
        source,
        "ENSV2_PERMISSIONED_RESOLVER_IMPL_ADDRESS",
      ),
      paymentToken: optional(source, "ENSV2_PAYMENT_TOKEN_ADDRESS"),
      universalResolver: optional(source, "ENSV2_UNIVERSAL_RESOLVER_ADDRESS"),
      parentLabel: optional(source, "ENSV2_PARENT_LABEL"),
      parentRegistry: optional(source, "ENSV2_PARENT_REGISTRY_ADDRESS"),
      permissionedResolver: optional(
        source,
        "ENSV2_PERMISSIONED_RESOLVER_ADDRESS",
      ),
    },
    erc8004: {
      identityRegistry: optional(source, "ERC8004_IDENTITY_REGISTRY_ADDRESS"),
      reputationRegistry: optional(source, "ERC8004_REPUTATION_REGISTRY_ADDRESS"),
      validationRegistry: optional(source, "ERC8004_VALIDATION_REGISTRY_ADDRESS"),
    },
    graph: {
      apiKey: optional(source, "GRAPH_API_KEY"),
      agent0SepoliaSubgraphId: optional(source, "GRAPH_AGENT0_SEPOLIA_SUBGRAPH_ID"),
      agent0BaseSepoliaSubgraphId: optional(
        source,
        "GRAPH_AGENT0_BASE_SEPOLIA_SUBGRAPH_ID",
      ),
    },
    privy: {
      appSecret: optional(source, "PRIVY_APP_SECRET"),
      authorizationKeyId: optional(source, "PRIVY_AUTHORIZATION_KEY_ID"),
      authorizationPrivateKey: optional(source, "PRIVY_AUTHORIZATION_PRIVATE_KEY"),
      policyId: optional(source, "PRIVY_POLICY_ID"),
    },
    demo: {
      allowedPaymentAmount: optional(source, "DEMO_ALLOWED_PAYMENT_AMOUNT"),
      deniedPaymentAmount: optional(source, "DEMO_DENIED_PAYMENT_AMOUNT"),
      paymentTokenAddress: optional(source, "DEMO_PAYMENT_TOKEN_ADDRESS"),
      paymentRecipient: optional(source, "DEMO_PAYMENT_RECIPIENT"),
    },
  };
  return cached;
}

/**
 * Assert that a named group of optional values is present, for a route that
 * genuinely needs it. Financial routes call this for `privy`, per the
 * startup-validation rules in docs/19_ENV_AND_CONFIG.md.
 */
export function requireServerEnv<const K extends readonly string[]>(names: K) {
  return requireAll(process.env, names);
}
