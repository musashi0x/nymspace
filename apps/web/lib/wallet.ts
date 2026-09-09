"use client";

import {
  createWalletClient,
  custom,
  type Address,
  type Hex,
  type WalletClient,
} from "viem";
import { sepolia } from "viem/chains";

/**
 * The organization's browser wallet.
 *
 * Deliberately thin. Every injected wallet exposes EIP-1193, and viem is
 * already in the workspace, so a connector library plus its React bindings plus
 * a query cache would be three dependencies bought for an interface we can call
 * directly. The Astryx design rule says to ask before adding a primitive; this
 * adds none.
 *
 * What this is NOT for: the agent controller. Its key stays on the server so
 * the agent can write unattended, which is the product's actual claim. This
 * module only ever signs organization-authority transactions.
 */

/** The minimum of EIP-1193 we rely on. */
type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (
    event: string,
    handler: (...args: unknown[]) => void,
  ) => void;
};

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export const EXPECTED_CHAIN = sepolia;

export class WalletError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "no_provider"
      | "rejected"
      | "wrong_chain"
      | "wrong_account"
      | "failed",
  ) {
    super(message);
    this.name = "WalletError";
  }
}

export function getProvider(): Eip1193Provider | undefined {
  if (typeof window === "undefined") return undefined;
  return window.ethereum;
}

/** True once a provider is injected. Used to explain rather than to gate. */
export function hasProvider(): boolean {
  return getProvider() !== undefined;
}

/**
 * Ask the wallet to connect, returning the selected account.
 *
 * A user rejecting the prompt is a normal outcome, not a failure to log, so it
 * comes back as a typed `rejected` rather than an opaque throw.
 */
export async function connect(): Promise<Address> {
  const provider = getProvider();
  if (!provider) {
    throw new WalletError(
      "No wallet detected. Install MetaMask, or open this page in a browser that has it.",
      "no_provider",
    );
  }

  try {
    const accounts = (await provider.request({
      method: "eth_requestAccounts",
    })) as Address[];
    const account = accounts[0];
    if (!account) {
      throw new WalletError("The wallet returned no account.", "failed");
    }
    return account;
  } catch (cause) {
    if (isUserRejection(cause)) {
      throw new WalletError("Connection was rejected in the wallet.", "rejected");
    }
    throw new WalletError(messageOf(cause, "Could not connect."), "failed");
  }
}

/** The already-authorised account, if any. Never prompts. */
export async function currentAccount(): Promise<Address | undefined> {
  const provider = getProvider();
  if (!provider) return undefined;
  const accounts = (await provider.request({
    method: "eth_accounts",
  })) as Address[];
  return accounts[0];
}

export async function currentChainId(): Promise<number | undefined> {
  const provider = getProvider();
  if (!provider) return undefined;
  const hex = (await provider.request({ method: "eth_chainId" })) as Hex;
  return Number.parseInt(hex, 16);
}

/**
 * Move the wallet to the expected chain, adding it if unknown.
 *
 * Signing on the wrong chain produces a transaction against a different
 * deployment of the same addresses, so this must succeed before any send.
 */
export async function ensureChain(): Promise<void> {
  const provider = getProvider();
  if (!provider) throw new WalletError("No wallet detected.", "no_provider");

  const current = await currentChainId();
  if (current === EXPECTED_CHAIN.id) return;

  const chainIdHex = `0x${EXPECTED_CHAIN.id.toString(16)}` as Hex;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
  } catch (cause) {
    // 4902: the wallet does not know this chain yet. Offer to add it rather
    // than telling the user to configure a network by hand.
    if (codeOf(cause) === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: chainIdHex,
            chainName: EXPECTED_CHAIN.name,
            nativeCurrency: EXPECTED_CHAIN.nativeCurrency,
            rpcUrls: [EXPECTED_CHAIN.rpcUrls.default.http[0]],
            blockExplorerUrls: [EXPECTED_CHAIN.blockExplorers?.default.url],
          },
        ],
      });
      return;
    }
    if (isUserRejection(cause)) {
      throw new WalletError(
        `The network switch to ${EXPECTED_CHAIN.name} was rejected.`,
        "rejected",
      );
    }
    throw new WalletError(
      messageOf(cause, `Could not switch to ${EXPECTED_CHAIN.name}.`),
      "wrong_chain",
    );
  }
}

function walletClient(account: Address): WalletClient {
  const provider = getProvider();
  if (!provider) throw new WalletError("No wallet detected.", "no_provider");
  return createWalletClient({
    account,
    chain: EXPECTED_CHAIN,
    transport: custom(provider),
  });
}

export interface PreparedTransaction {
  to: Address;
  data: Hex;
  chainId: number;
}

/**
 * Sign and broadcast a transaction the API prepared.
 *
 * `expectedSigner` is checked here rather than trusted from the UI: the account
 * can change in the wallet between render and click, and submitting from the
 * wrong account costs gas to learn what a string comparison answers for free.
 */
export async function sendPrepared(params: {
  transaction: PreparedTransaction;
  expectedSigner: Address;
}): Promise<Hex> {
  const { transaction, expectedSigner } = params;

  const account = await currentAccount();
  if (!account) {
    throw new WalletError("No account is connected.", "no_provider");
  }
  if (account.toLowerCase() !== expectedSigner.toLowerCase()) {
    throw new WalletError(
      `Connected as ${account}, but this action must be signed by the organization (${expectedSigner}). Switch accounts in your wallet.`,
      "wrong_account",
    );
  }
  if (transaction.chainId !== EXPECTED_CHAIN.id) {
    throw new WalletError(
      `The prepared transaction targets chain ${transaction.chainId}, not ${EXPECTED_CHAIN.id}.`,
      "wrong_chain",
    );
  }

  await ensureChain();

  try {
    return await walletClient(account).sendTransaction({
      account,
      chain: EXPECTED_CHAIN,
      to: transaction.to,
      data: transaction.data,
    });
  } catch (cause) {
    if (isUserRejection(cause)) {
      throw new WalletError("The transaction was rejected in the wallet.", "rejected");
    }
    throw new WalletError(messageOf(cause, "The transaction failed."), "failed");
  }
}

/** Subscribe to account or chain changes. Returns an unsubscribe. */
export function watchWallet(onChange: () => void): () => void {
  const provider = getProvider();
  if (!provider?.on || !provider.removeListener) return () => {};
  provider.on("accountsChanged", onChange);
  provider.on("chainChanged", onChange);
  return () => {
    provider.removeListener?.("accountsChanged", onChange);
    provider.removeListener?.("chainChanged", onChange);
  };
}

/** EIP-1193 rejection, plus MetaMask's own variant. */
function isUserRejection(cause: unknown): boolean {
  const code = codeOf(cause);
  return code === 4001 || code === "ACTION_REJECTED";
}

function codeOf(cause: unknown): number | string | undefined {
  if (cause && typeof cause === "object" && "code" in cause) {
    return (cause as { code?: number | string }).code;
  }
  return undefined;
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
