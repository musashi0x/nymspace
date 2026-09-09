import { decodeEventLog } from "viem";
import type { Address, ChainId, Hex } from "@nymspace/core";
import type { ChainClient, ChainReceipt } from "./ens-service";

/**
 * The ERC 8004 IdentityRegistry, and the registration file that carries an
 * agent's ENS claim.
 *
 * It lives in `@nymspace/ens` rather than a package of its own because ENSIP 25
 * is the only reason the product touches ERC 8004 at all: the key built in
 * `keys.ts` needs a registry address and an agent id, and verification reads
 * across both systems. Splitting them would put the two halves of one proof in
 * two packages with a circular dependency between them.
 *
 * The ABI is transcribed from `agent0lab/subgraph`'s pinned
 * `IdentityRegistry_Jan232026.json` — the same artifact the indexer runs
 * against, so a call this file makes and an event that indexer reads cannot
 * disagree about the shape.
 */

/**
 * The fragments the product calls. `register` is overloaded three ways on the
 * contract; only the single-argument form is here, because the metadata form
 * writes on-chain key/value pairs that the ENS claim does not use.
 */
export const identityRegistryAbi = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "setAgentURI",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "newURI", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "getMetadata",
    stateMutability: "view",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "metadataKey", type: "string" },
    ],
    outputs: [{ name: "", type: "bytes" }],
  },
  {
    type: "event",
    name: "Registered",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "agentURI", type: "string", indexed: false },
      { name: "owner", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "URIUpdated",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "newURI", type: "string", indexed: false },
      { name: "updatedBy", type: "address", indexed: true },
    ],
  },
] as const;

//////////////////////////////////////////////////////////////////////////////
// The registration file
//////////////////////////////////////////////////////////////////////////////

/** The `type` every ERC 8004 registration file declares. */
export const REGISTRATION_FILE_TYPE =
  "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";

/**
 * One entry in `services`.
 *
 * `services` is the canonical key; Agent0's parser accepts `endpoints` as a
 * legacy alias and this writes the canonical one. The `name` is matched
 * lowercased against a fixed set — `mcp`, `a2a`, `web`, `oasf`, `email`, `ens`,
 * `did` — and anything else is kept in `endpointsRawJson` but populates no
 * typed field.
 */
export interface RegistrationService {
  name: "mcp" | "a2a" | "web" | "oasf" | "email" | "ens" | "did";
  endpoint: string;
  version?: string;
  skills?: string[];
  domains?: string[];
}

export interface RegistrationFile {
  type: string;
  name: string;
  description?: string;
  image?: string;
  active?: boolean;
  supportedTrusts?: string[];
  services: RegistrationService[];
}

export interface BuildRegistrationFileParams {
  name: string;
  description?: string;
  /**
   * The agent's ENS name. Written as a `services` entry named `ens`, which is
   * what populates `AgentRegistrationFile.ens` and what task 3.9 asserts
   * against. There is no other field in the format that carries an ENS claim.
   */
  ensName: string;
  mcpEndpoint?: string;
  a2aEndpoint?: string;
  webEndpoint?: string;
  supportedTrusts?: string[];
  active?: boolean;
}

/**
 * Build the registration file.
 *
 * An endpoint that does not exist is omitted rather than written empty. An
 * empty `endpoint` string is skipped by Agent0's parser anyway, so writing one
 * would put a field in the file that no reader ever sees — the file would claim
 * a capability the agent does not have, which is the thing `docs/04` forbids.
 */
export function buildRegistrationFile(
  params: BuildRegistrationFileParams,
): RegistrationFile {
  const services: RegistrationService[] = [
    { name: "ens", endpoint: params.ensName },
  ];
  if (params.mcpEndpoint) {
    services.push({ name: "mcp", endpoint: params.mcpEndpoint });
  }
  if (params.a2aEndpoint) {
    services.push({ name: "a2a", endpoint: params.a2aEndpoint });
  }
  if (params.webEndpoint) {
    services.push({ name: "web", endpoint: params.webEndpoint });
  }

  return {
    type: REGISTRATION_FILE_TYPE,
    name: params.name,
    ...(params.description && { description: params.description }),
    active: params.active ?? true,
    supportedTrusts: params.supportedTrusts ?? [],
    services,
  };
}

const DATA_URI_PREFIX = "data:application/json;base64,";

/**
 * Encode a registration file as the `agentURI`.
 *
 * A base64 data URI rather than `ipfs://`, per design.md D13. Agent0's mapping
 * parses exactly two forms and an `https://` URI is stored and then never
 * fetched, producing an agent with no name, no ENS claim, and no endpoints. The
 * data URI keeps the whole file in calldata, which costs a little gas and
 * removes a pinning service from the critical path — and it is the form five of
 * twenty live Base Sepolia agents already use.
 */
export function encodeRegistrationFileUri(file: RegistrationFile): string {
  return `${DATA_URI_PREFIX}${Buffer.from(JSON.stringify(file), "utf8").toString("base64")}`;
}

/** Decode an `agentURI` that carries its file inline. Undefined otherwise. */
export function decodeRegistrationFileUri(
  agentURI: string,
): RegistrationFile | undefined {
  if (!agentURI.startsWith(DATA_URI_PREFIX)) return undefined;
  try {
    return JSON.parse(
      Buffer.from(agentURI.slice(DATA_URI_PREFIX.length), "base64").toString(
        "utf8",
      ),
    ) as RegistrationFile;
  } catch {
    return undefined;
  }
}

/** The ENS name a registration file claims, if it claims one. */
export function claimedEnsName(file: RegistrationFile): string | undefined {
  return file.services.find((service) => service.name === "ens")?.endpoint;
}

//////////////////////////////////////////////////////////////////////////////
// The registry client
//////////////////////////////////////////////////////////////////////////////

export interface Erc8004Registration {
  agentId: string;
  agentURI: string;
  owner: Address;
  transactionHash: Hex;
  blockNumber?: string;
}

export interface Erc8004ServiceOptions {
  client: ChainClient;
  registry: Address;
  chainId: ChainId;
}

export class Erc8004Service {
  readonly registry: Address;
  readonly chainId: ChainId;
  private readonly client: ChainClient;

  constructor({ client, registry, chainId }: Erc8004ServiceOptions) {
    this.client = client;
    this.registry = registry;
    this.chainId = chainId;
  }

  /**
   * Register an agent and return the id the registry minted.
   *
   * The id arrives in the `Registered` event rather than from the call's return
   * value, because a transaction receipt carries logs and not return data. The
   * event is decoded here rather than by the caller so that "which agent id did
   * I just create" has exactly one answer in the codebase.
   */
  async register(params: {
    file: RegistrationFile;
    as?: "organization" | "controller";
  }): Promise<Erc8004Registration> {
    const agentURI = encodeRegistrationFileUri(params.file);

    const hash = await this.client.writeContract({
      address: this.registry,
      abi: identityRegistryAbi,
      functionName: "register",
      args: [agentURI],
      as: params.as ?? "organization",
    });

    const receipt = await this.client.waitForReceipt(hash);
    if (receipt.status !== "success") {
      throw new Error(`ERC 8004 registration reverted: ${hash}`);
    }

    const registered = this.decodeRegistered(receipt);
    if (!registered) {
      throw new Error(
        `ERC 8004 registration confirmed but emitted no Registered event: ${hash}`,
      );
    }

    // Do not return until the registration is readable.
    //
    // A confirmed receipt says the transaction is in a block; it does not say
    // the node the next read lands on has that block. Public endpoints are
    // load-balanced, and a `tokenURI` immediately after a `register` really
    // does revert with "nonexistent token" on a lagging replica — which reads
    // as a broken registration rather than as a stale node.
    await this.waitUntilReadable(registered.agentId);

    return { ...registered, agentURI, transactionHash: hash };
  }

  /**
   * Poll until the agent's URI can be read, or give up loudly.
   *
   * Short and bounded: this covers replica lag, not an outage. A registration
   * that is still unreadable after this is a real problem and the caller should
   * see it rather than have it retried away.
   */
  private async waitUntilReadable(
    agentId: string,
    attempts = 6,
    delayMs = 2000,
  ): Promise<void> {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        if ((await this.agentURI(agentId)).length > 0) return;
      } catch {
        // A revert here is the lagging-replica case, not a verdict.
      }
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    throw new Error(
      `ERC 8004 agent ${agentId} was registered but its URI is still unreadable ` +
        `after ${attempts} attempts. The write confirmed, so this is the RPC, not the registry.`,
    );
  }

  /** Pull `Registered(agentId, agentURI, owner)` out of a receipt. */
  private decodeRegistered(
    receipt: ChainReceipt,
  ): { agentId: string; owner: Address } | undefined {
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== this.registry.toLowerCase()) continue;
      try {
        const event = decodeEventLog({
          abi: identityRegistryAbi,
          topics: log.topics,
          data: log.data,
        });
        if (event.eventName !== "Registered") continue;
        const args = event.args as unknown as {
          agentId: bigint;
          owner: Address;
        };
        return { agentId: args.agentId.toString(10), owner: args.owner };
      } catch {
        // Another event from the same contract — an ERC 721 Transfer, for one.
      }
    }
    return undefined;
  }

  /** The `agentURI` currently recorded for an agent. */
  async agentURI(agentId: string | number | bigint): Promise<string> {
    const uri = await this.client.readContract({
      address: this.registry,
      abi: identityRegistryAbi,
      functionName: "tokenURI",
      args: [BigInt(agentId)],
    });
    return typeof uri === "string" ? uri : "";
  }

  async ownerOf(agentId: string | number | bigint): Promise<Address> {
    return (await this.client.readContract({
      address: this.registry,
      abi: identityRegistryAbi,
      functionName: "ownerOf",
      args: [BigInt(agentId)],
    })) as Address;
  }

  /**
   * The registration file an agent currently publishes, read from chain.
   *
   * Undefined when the `agentURI` is an `ipfs://` or `https://` URI, because
   * this reads what the transaction carries and does not fetch. That is the
   * honest answer: a caller wanting a remote file should say so, and the
   * product does not write those forms.
   */
  async registrationFile(
    agentId: string | number | bigint,
  ): Promise<RegistrationFile | undefined> {
    return decodeRegistrationFileUri(await this.agentURI(agentId));
  }

  /**
   * Whether the registration claims `ensName`.
   *
   * Compared lowercased, which is the normalisation ENS names carry anyway, and
   * is what task 3.9's "string-equals after normalization" means here.
   */
  async claimsEnsName(
    agentId: string | number | bigint,
    ensName: string,
  ): Promise<{ claims: boolean; claimed?: string }> {
    const file = await this.registrationFile(agentId);
    if (!file) return { claims: false };
    const claimed = claimedEnsName(file);
    return {
      claims: claimed?.toLowerCase() === ensName.toLowerCase(),
      ...(claimed && { claimed }),
    };
  }
}
