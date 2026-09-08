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
import type { ChainClient, ChainReceipt } from "./ens-service";

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

export interface ViemChainClientOptions {
  rpcUrl: string;
  chainId: number;
  /** 0x-prefixed testnet private keys. Never production key material. */
  organizationKey: Hex;
  controllerKey: Hex;
}

export interface ViemChainClient extends ChainClient {
  readonly organization: Address;
  readonly controller: Address;
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

  const accounts = {
    organization: privateKeyToAccount(options.organizationKey),
    controller: privateKeyToAccount(options.controllerKey),
  } as const;

  if (accounts.organization.address === accounts.controller.address) {
    throw new Error(
      "The organization and controller keys are the same account. The spike " +
        "would prove nothing: every denial would be a self-denial.",
    );
  }

  const wallets: Record<Signer, WalletClient> = {
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
  };

  return {
    organization: accounts.organization.address,
    controller: accounts.controller.address,
    publicClient,

    addressOf(signer) {
      return accounts[signer].address;
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
          topics: log.topics as Hex[],
          data: log.data,
        })),
      };
    },

    async getCode(address) {
      return publicClient.getCode({ address });
    },

    async getBalance(address) {
      return publicClient.getBalance({ address });
    },
  };
}
