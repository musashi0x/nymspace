import { createMiddleware } from "hono/factory";
import type { Address, Hex } from "@nymspace/core";
import { requireServerEnv } from "@nymspace/core/env";
import {
  EnsService,
  Erc8004Service,
  chainConfig,
  createViemChainClient,
  requireDeployed,
  type ChainConfig,
  type ViemChainClient,
} from "@nymspace/ens";
import { Agent0Client } from "@nymspace/graph";
import { PrivyClient } from "@nymspace/privy";
import { Store, database, migrate } from "@nymspace/store";

/**
 * Everything the route handlers need, injected through the context.
 *
 * Handlers orchestrate; packages hold the domain logic. This module is the
 * seam: it is the only place in `apps/api` that constructs a chain client, a
 * store, or a provider client, so no handler can quietly acquire a credential
 * or derive an EAC resource itself.
 *
 * Delivered as middleware rather than imported as a singleton, which is Hono's
 * own pattern and buys two things. `c.var.deps` is typed, so a handler reaching
 * for something the middleware does not provide is a compile error; and a test
 * mounts its own middleware instead of arranging module state before an import
 * that has already hoisted.
 *
 * Construction is still cached across requests — building a viem client per
 * request would open a connection pool per request — but the cache lives here
 * rather than in every consumer.
 */

export const ORGANIZATION_ID = "nymspace";

/** Base Sepolia. Where the ERC 8004 registration lives — design.md D14. */
export const REGISTRATION_CHAIN_ID = 84532;

export interface Deps {
  store: Store;
  ens: EnsService;
  erc8004: Erc8004Service;
  graph: Agent0Client;
  privy: PrivyClient;
  chain: ViemChainClient;
  config: ChainConfig;
  organization: Address;
  controller: Address;
  resolver: Address;
  registry: Address;
}

/** The context shape every product route sees. */
export type DepsEnv = { Variables: { deps: Deps } };

let cached: Deps | undefined;
let migrated = false;

export async function buildDeps(): Promise<Deps> {
  if (cached) return cached;

  const config = chainConfig();
  const deployed = requireDeployed(config);
  const env = requireServerEnv([
    "ENSV2_ORGANIZATION_PRIVATE_KEY",
    "ENSV2_AGENT_CONTROLLER_PRIVATE_KEY",
    "ERC8004_BASE_SEPOLIA_IDENTITY_REGISTRY_ADDRESS",
  ] as const);

  const organizationKey = env.ENSV2_ORGANIZATION_PRIVATE_KEY as Hex;
  const controllerKey = env.ENSV2_AGENT_CONTROLLER_PRIVATE_KEY as Hex;

  const chain = createViemChainClient({
    rpcUrl: config.rpcUrl,
    chainId: config.chainId,
    organizationKey,
    controllerKey,
  });

  const registrationClient = createViemChainClient({
    rpcUrl: process.env["BASE_SEPOLIA_RPC_URL"] ?? "https://sepolia.base.org",
    chainId: REGISTRATION_CHAIN_ID,
    organizationKey,
    controllerKey,
  });

  const db = database();
  if (!migrated) {
    await migrate(db);
    migrated = true;
  }

  cached = {
    store: new Store(db),
    ens: new EnsService({ client: chain, config }),
    erc8004: new Erc8004Service({
      client: registrationClient,
      registry: env.ERC8004_BASE_SEPOLIA_IDENTITY_REGISTRY_ADDRESS as Address,
      chainId: REGISTRATION_CHAIN_ID,
    }),
    graph: new Agent0Client(),
    privy: new PrivyClient(),
    chain,
    config,
    organization: chain.organization,
    controller: chain.controller,
    resolver: deployed.permissionedResolver,
    registry: deployed.parentRegistry,
  };
  return cached;
}

/**
 * The middleware.
 *
 * Takes an optional container so a test can inject fakes without touching the
 * environment. `/health` deliberately does not mount this: a liveness check
 * that needs an RPC to answer is reporting the RPC's health, not its own.
 */
export function withDeps(override?: Deps) {
  return createMiddleware<DepsEnv>(async (c, next) => {
    c.set("deps", override ?? (await buildDeps()));
    await next();
  });
}

/** Tests, so one case's fakes cannot leak into the next. */
export function resetDeps(): void {
  cached = undefined;
  migrated = false;
}
