import { createMiddleware } from "hono/factory";
import { isAddress } from "viem";
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

/**
 * The address to check authority for when no signing key is configured.
 *
 * Named separately from the key so the read-only path is explicit rather than
 * a key that happens to be absent, and so the error says exactly which of the
 * two variables to set for the mode you want.
 */
function requireReadAddress(addressVar: string, keyVar: string): Address {
  const value = process.env[addressVar];
  if (!value) {
    throw new Error(
      `Set ${keyVar} to enable writes, or ${addressVar} to run read-only. ` +
        `Reads need the account to check permissions for, not its key.`,
    );
  }
  /**
   * Validated, not cast.
   *
   * A truncated paste is the likely way this goes wrong, and it fails
   * silently: `hasRoles` for an address nobody holds returns false, so every
   * cell in the permission matrix reads denied and the console shows an agent
   * the resolver appears to have refused. A misconfiguration that renders as a
   * policy decision is the one failure this product must not produce.
   */
  if (!isAddress(value)) {
    throw new Error(
      `${addressVar} is not an address: ${value}. An unchecked value here ` +
        `reads back as a fully denied permission matrix, not as an error.`,
    );
  }
  return value;
}

export const ORGANIZATION_ID = "nymspace";

/** Base Sepolia. Where the ERC 8004 registration lives — design.md D14. */
export const REGISTRATION_CHAIN_ID = 84532;

export interface Deps {
  store: Store;
  ens: EnsService;
  erc8004: Erc8004Service;
  graph: Agent0Client;
  /**
   * Lazy. `new PrivyClient()` validates its credentials in the constructor, so
   * building it eagerly made a missing Privy secret break every route in the
   * app — including the fleet list, which never touches a wallet. Constructing
   * on first access keeps the failure where it belongs: on the payment routes.
   */
  readonly privy: PrivyClient;
  chain: ViemChainClient;
  config: ChainConfig;
  organization: Address;
  controller: Address;
  resolver: Address;
  registry: Address;
  /**
   * Resolved here from the deployment config rather than read from a row: the
   * parent is where authority starts, and taking it from the store would let a
   * database edit reparent the fleet.
   */
  parentName: string;
}

/** The context shape every product route sees. */
export type DepsEnv = { Variables: { deps: Deps } };

let cached: Deps | undefined;
let migrated = false;
let privyClient: PrivyClient | undefined;

export async function buildDeps(): Promise<Deps> {
  if (cached) return cached;

  const config = chainConfig();
  const deployed = requireDeployed(config);
  const env = requireServerEnv([
    "ERC8004_BASE_SEPOLIA_IDENTITY_REGISTRY_ADDRESS",
  ] as const);

  /**
   * Signing keys are optional here, deliberately.
   *
   * They used to be required to *construct* the deps, which meant a read-only
   * route — `GET /v1/agents` reads Postgres and signs nothing — could not run
   * without the funded signers. That locked every console screen behind
   * credentials only one person holds: not a teammate, not CI, not a judge who
   * cloned the repo. It also contradicts the rule of keeping the organization
   * signing path out of routine execution.
   *
   * So: keys when present, addresses otherwise. Reads work either way, and a
   * write on a keyless client throws NoSignerError, which the error handler
   * turns into a 503 that says which variable is missing.
   */
  const organizationKey = process.env["ENSV2_ORGANIZATION_PRIVATE_KEY"] as
    | Hex
    | undefined;
  const controllerKey = process.env["ENSV2_AGENT_CONTROLLER_PRIVATE_KEY"] as
    | Hex
    | undefined;

  const signers =
    organizationKey && controllerKey
      ? ({ organizationKey, controllerKey } as const)
      : ({
          organizationAddress: requireReadAddress(
            "ENSV2_ORGANIZATION_ADDRESS",
            "ENSV2_ORGANIZATION_PRIVATE_KEY",
          ),
          controllerAddress: requireReadAddress(
            "ENSV2_AGENT_CONTROLLER_ADDRESS",
            "ENSV2_AGENT_CONTROLLER_PRIVATE_KEY",
          ),
        } as const);

  const chain = createViemChainClient({
    rpcUrl: config.rpcUrl,
    chainId: config.chainId,
    ...signers,
  });

  const registrationClient = createViemChainClient({
    rpcUrl: process.env["BASE_SEPOLIA_RPC_URL"] ?? "https://sepolia.base.org",
    chainId: REGISTRATION_CHAIN_ID,
    ...signers,
  });

  const db = database();
  const store = new Store(db);
  if (!migrated) {
    await migrate(db);

    /**
     * The row every agent's `organization_id` points at.
     *
     * `scripts/provision-fleet.ts` upserts this before it provisions anything,
     * and when the script was the only path that was enough. It stopped being
     * enough at design D7, when the per-agent sequence moved into
     * `provisionAgent` so `POST /v1/agents` could share it — the sequence
     * moved, this did not, and the route was left assuming a row only the
     * script wrote.
     *
     * Nothing catches that until the database is genuinely empty, which is
     * exactly once per deployment and never in a test that seeds its own
     * fixtures. On a fresh Railway Postgres every create, from the console's
     * own screen included, failed on the foreign key with `internal error`.
     *
     * It belongs beside the migration rather than in the handler: both make
     * the database usable, both are idempotent, and neither is a per-request
     * concern. The parent comes from the deployment config, never from a row,
     * for the reason `parentName` gives below.
     */
    await store.upsertOrganization({
      id: ORGANIZATION_ID,
      displayName: "Nymspace",
      parentEnsName: `${deployed.parentLabel}.eth`,
      chainId: config.chainId,
    });

    migrated = true;
  }

  cached = {
    store,
    ens: new EnsService({ client: chain, config }),
    erc8004: new Erc8004Service({
      client: registrationClient,
      registry: env.ERC8004_BASE_SEPOLIA_IDENTITY_REGISTRY_ADDRESS as Address,
      chainId: REGISTRATION_CHAIN_ID,
    }),
    graph: new Agent0Client(),
    get privy() {
      privyClient ??= new PrivyClient();
      return privyClient;
    },
    chain,
    config,
    organization: chain.organization,
    controller: chain.controller,
    resolver: deployed.permissionedResolver,
    registry: deployed.parentRegistry,
    parentName: `${deployed.parentLabel}.eth`,
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
  privyClient = undefined;
}
