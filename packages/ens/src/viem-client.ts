import {
  createPublicClient,
  createWalletClient,
  http,
  type Chain,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, sepolia } from "viem/chains";
import type { Address, Hex } from "@nymspace/core";
import type { ChainClient, ChainLog, ChainReceipt } from "./ens-service";

/**
 * The viem-backed {@link ChainClient}.
 *
 * `EnsService` takes a structural port so the package stays importable by a
 * plain script and by a future standalone service; this is the one place viem
 * is instantiated, and the one place key material is loaded.
 *
 * Two signers rather than one, because the whole spike turns on the difference
 * between them. The organization owns the parent name, the registry proxy, and
 * the resolver proxy; the controller is the agent's own key, holds exactly one
 * delegated record, and everything else it attempts must revert from the
 * contract rather than from an application check.
 */

export type Signer = "organization" | "controller";

const CHAINS: Record<number, Chain> = {
  [sepolia.id]: sepolia,
  [baseSepolia.id]: baseSepolia,
};

/**
 * Thrown when a write is attempted on a client built without signing keys.
 *
 * Its own class so a route can answer 503 with an explanation rather than
 * surfacing a 500 that reads like a bug.
 */
export class NoSignerError extends Error {
  constructor(signer: Signer) {
    super(
      `No signing key configured for the ${signer}. This client was built ` +
        `read-only: set ENSV2_ORGANIZATION_PRIVATE_KEY and ` +
        `ENSV2_AGENT_CONTROLLER_PRIVATE_KEY to enable writes.`,
    );
    this.name = "NoSignerError";
  }
}

/**
 * Either both private keys, or just the two addresses.
 *
 * The addresses-only form exists because reads need to know *who* to check
 * permissions for, not how to sign as them. Requiring keys for that made every
 * read route — including ones that only touch Postgres — unusable by anyone
 * without the funded signers: a teammate, CI, or a judge cloning the repo.
 */
export type ViemChainClientOptions = {
  rpcUrl: string;
  chainId: number;
} & (
  | {
      /** 0x-prefixed testnet private keys. Never production key material. */
      organizationKey: Hex;
      controllerKey: Hex;
      organizationAddress?: never;
      controllerAddress?: never;
    }
  | {
      organizationKey?: never;
      controllerKey?: never;
      /** Read-only: the accounts to check authority for, not to sign with. */
      organizationAddress: Address;
      controllerAddress: Address;
    }
);

export interface ViemChainClient extends ChainClient {
  readonly organization: Address;
  readonly controller: Address;
  /** False when built from addresses only: reads work, writes throw. */
  readonly canSign: boolean;
  addressOf(signer: Signer): Address;
  getCode(address: Address): Promise<Hex | undefined>;
  getBalance(address: Address): Promise<bigint>;
  readonly publicClient: PublicClient;
}

export function createViemChainClient(
  options: ViemChainClientOptions,
): ViemChainClient {
  const chain = CHAINS[options.chainId];
  if (!chain) {
    throw new Error(
      `No viem chain definition for chain id ${options.chainId}. ` +
        `Add it to CHAINS in viem-client.ts.`,
    );
  }

  const transport = http(options.rpcUrl);
  const publicClient = createPublicClient({ chain, transport }) as PublicClient;

  // Narrow on the property itself rather than a boolean: a `canSign` variable
  // does not narrow the discriminated union for the compiler.
  const accounts =
    options.organizationKey !== undefined
      ? ({
          organization: privateKeyToAccount(options.organizationKey),
          controller: privateKeyToAccount(options.controllerKey),
        } as const)
      : undefined;

  const addresses: Record<Signer, Address> = accounts
    ? {
        organization: accounts.organization.address,
        controller: accounts.controller.address,
      }
    : {
        organization: options.organizationAddress as Address,
        controller: options.controllerAddress as Address,
      };

  const canSign = accounts !== undefined;

  if (addresses.organization === addresses.controller) {
    throw new Error(
      "The organization and controller are the same account. The spike " +
        "would prove nothing: every denial would be a self-denial.",
    );
  }

  const wallets: Record<Signer, WalletClient> | undefined = accounts
    ? {
        organization: createWalletClient({
          account: accounts.organization,
          chain,
          transport,
        }),
        controller: createWalletClient({
          account: accounts.controller,
          chain,
          transport,
        }),
      }
    : undefined;

  return {
    organization: addresses.organization,
    controller: addresses.controller,
    canSign,
    publicClient,

    addressOf(signer) {
      return addresses[signer];
    },

    async readContract(request) {
      return publicClient.readContract({
        address: request.address,
        abi: request.abi as never,
        functionName: request.functionName as never,
        args: request.args as never,
      });
    },

    async writeContract(request) {
      const signer: Signer = request.as ?? "organization";
      if (!accounts || !wallets) throw new NoSignerError(signer);
      // Simulate first: a revert then arrives as a decoded custom error with
      // the contract's own name for it, rather than as an opaque failed
      // receipt. The negative proofs depend on being able to read why.
      const { request: prepared } = await publicClient.simulateContract({
        account: accounts[signer],
        address: request.address,
        abi: request.abi as never,
        functionName: request.functionName as never,
        args: request.args as never,
      });
      return wallets[signer].writeContract(prepared as never);
    },

    async waitForReceipt(hash): Promise<ChainReceipt> {
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return {
        transactionHash: receipt.transactionHash,
        status: receipt.status,
        logs: receipt.logs.map((log) => ({
          address: log.address,
          topics: log.topics as ChainLog["topics"],
          data: log.data,
        })),
      };
    },

    async getLogs(request) {
      const logs = await publicClient.getLogs({
        address: request.address,
        fromBlock: request.fromBlock ?? "earliest",
        toBlock: request.toBlock ?? "latest",
      });
      return logs.map((log) => ({
        address: log.address,
        topics: log.topics as ChainLog["topics"],
        data: log.data,
      }));
    },

    async getCode(address) {
      return publicClient.getCode({ address });
    },

    async getBalance(address) {
      return publicClient.getBalance({ address });
    },
  };
}
