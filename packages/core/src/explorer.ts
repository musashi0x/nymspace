import type { ChainId } from "./types";

/**
 * Block explorer links for the chains this product writes to.
 *
 * The console shows a transaction hash in several places — the create-agent
 * step table, the activity timeline — and a hash alone is not verifiable by
 * anyone who does not already know which chain and which explorer to paste it
 * into. Keyed by chain id so a caller with an {@link ActivityEvidence} (which
 * carries the chain a write actually happened on, not just "the chain this
 * app currently points at") gets the right link.
 */
const EXPLORER_TX_BASE: Partial<Record<ChainId, string>> = {
  1: "https://etherscan.io/tx/",
  11155111: "https://sepolia.etherscan.io/tx/",
  8453: "https://basescan.org/tx/",
  84532: "https://sepolia.basescan.org/tx/",
};

const ZERO_HASH_RE = /^0x0+$/;

/**
 * `null` for a chain with no configured explorer, or a hash that is not a
 * real transaction — `provisioning.ts` writes the zero hash for a skipped
 * step, and that is not evidence to link to.
 */
export function explorerTxUrl(
  chainId: ChainId,
  txHash: string | null | undefined,
): string | null {
  if (!txHash || ZERO_HASH_RE.test(txHash)) return null;
  const base = EXPLORER_TX_BASE[chainId];
  return base ? `${base}${txHash}` : null;
}
