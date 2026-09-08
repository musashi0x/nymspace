import type { Address, AgentPermissions, Hex } from "@nymspace/core";
import { permissionedResolverAbi } from "./abis";
import { chainConfig, type ChainConfig } from "./chain";
import {
  hasRoles,
  nameResource,
  recordResource,
  ROLE,
  type EacResource,
  type ResourceDeriver,
} from "./eac";

/**
 * The single boundary through which every ENS read and write passes.
 *
 * docs/17_RISKS_AND_FALLBACKS.md Risk 1 asks for exactly one place that breaks
 * when the ENSv2 beta moves. The spike script and the route handlers both go
 * through this class, so there is one implementation rather than two that drift.
 *
 * The chain client is a structural port rather than a viem import: this package
 * must stay importable by a plain script and by a future standalone service,
 * and the client library is pinned by the Day 1 spike, not by this scaffold.
 */

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
  }): Promise<Hex>;
}

export interface EnsServiceOptions {
  client: ChainClient;
  deriveResource: ResourceDeriver;
  config?: ChainConfig;
}

export class EnsService {
  private readonly client: ChainClient;
  private readonly deriveResource: ResourceDeriver;
  readonly config: ChainConfig;

  constructor({ client, deriveResource, config }: EnsServiceOptions) {
    this.client = client;
    this.deriveResource = deriveResource;
    this.config = config ?? chainConfig();
  }

  /** Read one ENSIP 26 text record from the permissioned resolver. */
  async readText(node: Hex, key: string): Promise<string> {
    const value = await this.client.readContract({
      address: this.config.ensv2.permissionedResolver,
      abi: permissionedResolverAbi,
      functionName: "text",
      args: [node, key],
    });
    return typeof value === "string" ? value : "";
  }

  /** Write one ENSIP 26 text record. Returns the transaction hash. */
  async writeText(node: Hex, key: string, value: string): Promise<Hex> {
    return this.client.writeContract({
      address: this.config.ensv2.permissionedResolver,
      abi: permissionedResolverAbi,
      functionName: "setText",
      args: [node, key, value],
    });
  }

  /** Grant or revoke a controller's right to write one record key. */
  async authorizeTextRole(params: {
    dnsName: Hex;
    key: string;
    controller: Address;
    authorized: boolean;
  }): Promise<Hex> {
    return this.client.writeContract({
      address: this.config.ensv2.permissionedResolver,
      abi: permissionedResolverAbi,
      functionName: "authorizeTextRoles",
      args: [params.dnsName, params.key, params.controller, params.authorized],
    });
  }

  /** The live role bitmap a controller holds over one resource. */
  async rolesFor(
    resource: EacResource,
    controller: Address,
  ): Promise<bigint> {
    const derived = await this.deriveResource(resource);
    const bitmap = await this.client.readContract({
      address: this.config.ensv2.permissionedResolver,
      abi: permissionedResolverAbi,
      functionName: "roles",
      args: [derived, controller],
    });
    return typeof bitmap === "bigint" ? bitmap : BigInt(String(bitmap ?? 0));
  }

  /**
   * The permission surface the UI renders, produced entirely from chain reads.
   * docs/05_ENSV2_IMPLEMENTATION.md: never derive these from local flags.
   */
  async permissionsFor(params: {
    name: string;
    controller: Address;
    recordKeys: string[];
  }): Promise<AgentPermissions> {
    const { name, controller, recordKeys } = params;

    const records: Record<string, boolean> = {};
    for (const key of recordKeys) {
      const bitmap = await this.rolesFor(recordResource(name, key), controller);
      records[key] = hasRoles(bitmap, ROLE.SET_TEXT);
    }

    const nameBitmap = await this.rolesFor(nameResource(name), controller);

    return {
      controller,
      records,
      registry: {
        setResolver: hasRoles(nameBitmap, ROLE.SET_RESOLVER),
        setSubregistry: hasRoles(nameBitmap, ROLE.SET_SUBREGISTRY),
        unregister: hasRoles(nameBitmap, ROLE.UNREGISTER),
      },
    };
  }
}
