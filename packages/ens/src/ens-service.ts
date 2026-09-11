import { decodeEventLog, namehash } from "viem";
import {
  UnpublishableEndpointError,
  isPublishableEndpoint,
  type Address,
  type AgentPermissions,
  type Hex,
} from "@nymspace/core";
import { permissionedResolverAbi, registryAbi, verifiableFactoryAbi } from "./abis";
import { chainConfig, requireDeployed, type ChainConfig } from "./chain";
import {
  RESOLVER_ROLE,
  REGISTRY_ROLE,
  ROOT_RESOURCE,
  adminOf,
  deriveResource,
  nameResource,
  setTextResourceAlternatives,
  type EacResource,
  type ResourceDeriver,
} from "./eac";
import { agentEndpointKey, encodeDnsName } from "./keys";

/**
 * The single boundary through which every ENS read and write passes.
 *
 * docs/17_RISKS_AND_FALLBACKS.md Risk 1 asks for exactly one place that breaks
 * when the ENSv2 beta moves. The spike script and the route handlers both go
 * through this class, so there is one implementation rather than two that drift.
 *
 * The chain client is a structural port rather than a viem import: this package
 * must stay importable by a plain script and by a future standalone service.
 * `viem-client.ts` supplies the real one.
 */

/**
 * A log as the port returns it, narrow enough for any client to satisfy.
 *
 * `topics` is a tuple rather than an array because that is what a log is: an
 * optional event signature followed by its indexed arguments. Typing it as
 * `Hex[]` makes every `decodeEventLog` call site need a cast.
 */
export interface ChainLog {
  address: Address;
  topics: [signature: Hex, ...args: Hex[]] | [];
  data: Hex;
}

export interface ChainReceipt {
  transactionHash: Hex;
  status: "success" | "reverted";
  logs: ChainLog[];
}

/** The narrow slice of a chain client this service needs. */
export interface ChainClient {
  readContract(request: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  }): Promise<unknown>;

  writeContract(request: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
    /** Which configured key signs. The service never holds key material. */
    as?: "organization" | "controller";
  }): Promise<Hex>;

  waitForReceipt(hash: Hex): Promise<ChainReceipt>;

  /** Historical logs for one contract. Used to enumerate what was delegated. */
  getLogs(request: {
    address: Address;
    fromBlock?: bigint | "earliest";
    toBlock?: bigint | "latest";
  }): Promise<ChainLog[]>;
}

export interface EnsServiceOptions {
  client: ChainClient;
  deriveResource?: ResourceDeriver;
  config?: ChainConfig;
}

export class EnsService {
  private readonly client: ChainClient;
  private readonly derive: ResourceDeriver;
  readonly config: ChainConfig;

  constructor({ client, deriveResource: derive, config }: EnsServiceOptions) {
    this.client = client;
    this.derive = derive ?? deriveResource;
    this.config = config ?? chainConfig();
  }

  /** The resolver proxy the organization deployed. Throws before the spike runs. */
  get resolver(): Address {
    return requireDeployed(this.config).permissionedResolver;
  }

  /** The UserRegistry proxy wired under the parent label. */
  get registry(): Address {
    return requireDeployed(this.config).parentRegistry;
  }

  //////////////////////////////////////////////////////////////////////
  // Resolver — records
  //////////////////////////////////////////////////////////////////////

  /** Read one ENSIP 26 text record. */
  async readText(name: string, key: string): Promise<string> {
    const value = await this.client.readContract({
      address: this.resolver,
      abi: permissionedResolverAbi,
      functionName: "text",
      args: [namehash(name), key],
    });
    return typeof value === "string" ? value : "";
  }

  /**
   * Write one ENSIP 26 text record. Returns the transaction hash.
   *
   * Refuses a non-https MCP endpoint before a transaction is built. This is
   * the backstop for every caller that does not validate first — provisioning,
   * the scripts, whatever is added next — because the record is public and a
   * local `AGENT_MCP_BASE_URL` must never reach it. An empty value clears the
   * record and is allowed.
   */
  async writeText(params: {
    name: string;
    key: string;
    value: string;
    as?: "organization" | "controller";
  }): Promise<Hex> {
    if (
      params.key === agentEndpointKey("mcp") &&
      params.value !== "" &&
      !isPublishableEndpoint(params.value)
    ) {
      throw new UnpublishableEndpointError(params.value);
    }
    return this.client.writeContract({
      address: this.resolver,
      abi: permissionedResolverAbi,
      functionName: "setText",
      args: [namehash(params.name), params.key, params.value],
      as: params.as,
    });
  }

  //////////////////////////////////////////////////////////////////////
  // Resolver — delegation
  //////////////////////////////////////////////////////////////////////

  /**
   * Grant or revoke a controller's right to write one record key.
   *
   * `authorize*` is the only grant path on this contract: `grantRoles` and
   * `revokeRoles` are declared `pure` on the deployed resolver and do nothing.
   * The caller needs `ROLE_SET_TEXT_ADMIN` effective on `resource(node, 0)`.
   */
  async authorizeTextRole(params: {
    dnsName: Hex;
    key: string;
    controller: Address;
    authorized: boolean;
  }): Promise<Hex> {
    return this.client.writeContract({
      address: this.resolver,
      abi: permissionedResolverAbi,
      functionName: "authorizeTextRoles",
      args: [params.dnsName, params.key, params.controller, params.authorized],
      as: "organization",
    });
  }

  /** Whether the organization may delegate this name's text records at all. */
  async canDelegateText(name: string, account: Address): Promise<boolean> {
    return this.resolverHasRoles(
      nameResource(name),
      adminOf(RESOLVER_ROLE.SET_TEXT),
      account,
    );
  }

  //////////////////////////////////////////////////////////////////////
  // Resolver — permission reads
  //////////////////////////////////////////////////////////////////////

  /**
   * `hasRoles` on the resolver: root-scoped roles ORed with resource-scoped
   * ones. This is the enforcement path's own predicate and the only correct
   * answer to "may this account do this".
   */
  async resolverHasRoles(
    resource: bigint,
    roles: bigint,
    account: Address,
  ): Promise<boolean> {
    return (await this.client.readContract({
      address: this.resolver,
      abi: permissionedResolverAbi,
      functionName: "hasRoles",
      args: [resource, roles, account],
    })) as boolean;
  }

  /**
   * `roles()` on the resolver: raw `_roles[resource][account]`, root roles NOT
   * ORed in. Correct only for proving where a grant is stored — an account
   * holding everything at root reads zero here. Never use it to answer whether
   * an action is permitted.
   */
  async resolverRolesAt(
    resource: bigint,
    account: Address,
  ): Promise<bigint> {
    const bitmap = await this.client.readContract({
      address: this.resolver,
      abi: permissionedResolverAbi,
      functionName: "roles",
      args: [resource, account],
    });
    return BigInt(bitmap as string | number | bigint);
  }

  /**
   * Whether `account` may write `key` on `name`, evaluating the same three
   * alternatives `onlyPartRoles` accepts.
   */
  async canSetText(
    name: string,
    key: string,
    account: Address,
  ): Promise<boolean> {
    for (const resource of setTextResourceAlternatives(name, key)) {
      if (
        await this.resolverHasRoles(resource, RESOLVER_ROLE.SET_TEXT, account)
      ) {
        return true;
      }
    }
    return false;
  }

  /** The live role bitmap stored for a controller at one resource. */
  async rolesFor(target: EacResource, controller: Address): Promise<bigint> {
    return this.resolverRolesAt(this.derive(target), controller);
  }

  //////////////////////////////////////////////////////////////////////
  // Registry
  //////////////////////////////////////////////////////////////////////

  /** `hasRoles` on a registry — a different EAC domain from the resolver. */
  async registryHasRoles(params: {
    registry: Address;
    resource: bigint;
    roles: bigint;
    account: Address;
  }): Promise<boolean> {
    return (await this.client.readContract({
      address: params.registry,
      abi: registryAbi,
      functionName: "hasRoles",
      args: [params.resource, params.roles, params.account],
    })) as boolean;
  }

  /** The subregistry wired under a label, or the zero address. */
  async getSubregistry(registry: Address, label: string): Promise<Address> {
    return (await this.client.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "getSubregistry",
      args: [label],
    })) as Address;
  }

  /** The resolver a label resolves through, or the zero address. */
  async getResolver(registry: Address, label: string): Promise<Address> {
    return (await this.client.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "getResolver",
      args: [label],
    })) as Address;
  }

  /** The current token id for a label. Changes when roles change. */
  async findTokenId(registry: Address, label: string): Promise<bigint> {
    const id = await this.client.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "findTokenId",
      args: [label],
    });
    return BigInt(id as string | number | bigint);
  }

  /** The owner of a label, or the zero address. */
  async findOwner(registry: Address, label: string): Promise<Address> {
    return (await this.client.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "findOwner",
      args: [label],
    })) as Address;
  }

  /** Point a label at a subregistry. Takes a token id, not a labelhash. */
  async setSubregistry(params: {
    registry: Address;
    tokenId: bigint;
    subregistry: Address;
  }): Promise<Hex> {
    return this.client.writeContract({
      address: params.registry,
      abi: registryAbi,
      functionName: "setSubregistry",
      args: [params.tokenId, params.subregistry],
      as: "organization",
    });
  }

  /** Point a label at a resolver. Takes a token id, not a labelhash. */
  async setResolver(params: {
    registry: Address;
    tokenId: bigint;
    resolver: Address;
    as?: "organization" | "controller";
  }): Promise<Hex> {
    return this.client.writeContract({
      address: params.registry,
      abi: registryAbi,
      functionName: "setResolver",
      args: [params.tokenId, params.resolver],
      as: params.as ?? "organization",
    });
  }

  /**
   * Register a subname directly on a registry the caller holds
   * `ROLE_REGISTRAR` on at `ROOT_RESOURCE`. No registrar contract and no
   * payment token: those exist to sell names to third parties.
   *
   * `expiry` must be in the future or the call reverts with
   * `CannotSetPastExpiry`.
   */
  async registerSubname(params: {
    registry: Address;
    label: string;
    owner: Address;
    subregistry: Address;
    resolver: Address;
    roleBitmap: bigint;
    expiry: bigint;
  }): Promise<Hex> {
    return this.client.writeContract({
      address: params.registry,
      abi: registryAbi,
      functionName: "register",
      args: [
        params.label,
        params.owner,
        params.subregistry,
        params.resolver,
        params.roleBitmap,
        params.expiry,
      ],
      as: "organization",
    });
  }

  /** Whether an account may register on a registry at all. */
  async canRegister(registry: Address, account: Address): Promise<boolean> {
    return this.registryHasRoles({
      registry,
      resource: ROOT_RESOURCE,
      roles: REGISTRY_ROLE.REGISTRAR,
      account,
    });
  }

  //////////////////////////////////////////////////////////////////////
  // Verifiable Factory
  //////////////////////////////////////////////////////////////////////

  /**
   * Deploy a proxy and return its transaction hash. The address arrives in the
   * `ProxyDeployed` event; the caller decodes the receipt, because event
   * decoding belongs to the client and not to this boundary.
   */
  async deployProxy(params: {
    implementation: Address;
    salt: bigint;
    initData: Hex;
  }): Promise<Hex> {
    return this.client.writeContract({
      address: this.config.ensv2.verifiableFactory,
      abi: verifiableFactoryAbi,
      functionName: "deployProxy",
      args: [params.implementation, params.salt, params.initData],
      as: "organization",
    });
  }

  waitForReceipt(hash: Hex): Promise<ChainReceipt> {
    return this.client.waitForReceipt(hash);
  }

  //////////////////////////////////////////////////////////////////////
  // The UI surface
  //////////////////////////////////////////////////////////////////////

  /**
   * The permission surface the UI renders, produced entirely from chain reads.
   *
   * Record permissions come from the resolver and registry permissions from
   * the registry — two contracts, because they are two EAC domains. Reading
   * both from one address is the mistake this method exists to prevent.
   */
  async permissionsFor(params: {
    name: string;
    label: string;
    controller: Address;
    recordKeys: string[];
  }): Promise<AgentPermissions & { readAt: string }> {
    const { name, label, controller, recordKeys } = params;
    const registry = this.registry;

    const records: Record<string, boolean> = {};
    for (const key of recordKeys) {
      records[key] = await this.canSetText(name, key, controller);
    }

    const tokenId = await this.findTokenId(registry, label);
    const resource = await this.registryResource(registry, tokenId);
    const registryRoles = async (role: bigint) =>
      this.registryHasRoles({ registry, resource, roles: role, account: controller });

    return {
      controller,
      records,
      registry: {
        setResolver: await registryRoles(REGISTRY_ROLE.SET_RESOLVER),
        setSubregistry: await registryRoles(REGISTRY_ROLE.SET_SUBREGISTRY),
        unregister: await registryRoles(REGISTRY_ROLE.UNREGISTER),
      },
      // ENSIP 25: a name transfer can make an earlier attestation stale, so a
      // permission read is only true as of the moment it was taken.
      readAt: new Date().toISOString(),
    };
  }

  /**
   * Which record keys actually carry a delegation on this name.
   *
   * `authorizeTextRoles` emits `NamedTextResource(resource, name, keyHash,
   * key)` the first time a key is granted, and it carries the human-readable
   * key. That is the only way to enumerate delegations: the resource id is a
   * hash, so without this event the UI could only probe a hardcoded key list
   * and would silently miss anything granted outside it.
   *
   * The event records that a key was *ever* granted, not that it is granted
   * now, so each candidate is re-checked with `hasRoles` before it is
   * reported. A revoked key keeps its event forever.
   */
  async delegatedKeys(params: {
    name: string;
    controller: Address;
    fromBlock?: bigint | "earliest";
  }): Promise<{ key: string; granted: boolean }[]> {
    const logs = await this.client.getLogs({
      address: this.resolver,
      fromBlock: params.fromBlock ?? "earliest",
    });

    const dnsName = encodeDnsName(params.name);
    const keys = new Set<string>();

    for (const log of logs) {
      try {
        const event = decodeEventLog({
          abi: permissionedResolverAbi,
          topics: log.topics,
          data: log.data,
        });
        if (event.eventName !== "NamedTextResource") continue;
        const args = event.args as unknown as { name: Hex; key: string };
        if (args.name.toLowerCase() === dnsName.toLowerCase()) keys.add(args.key);
      } catch {
        // A log from another event on the same contract.
      }
    }

    const out: { key: string; granted: boolean }[] = [];
    for (const key of [...keys].sort()) {
      out.push({
        key,
        granted: await this.canSetText(params.name, key, params.controller),
      });
    }
    return out;
  }

  /** The registry's stable EAC resource for a token id. */
  async registryResource(
    registry: Address,
    tokenId: bigint,
  ): Promise<bigint> {
    const resource = await this.client.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "getResource",
      args: [tokenId],
    });
    return BigInt(resource as string | number | bigint);
  }
}
