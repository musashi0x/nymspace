import type { Address, ChainId, Hex } from "./types";

/**
 * ERC 7930 interoperable address encoding, restricted to the EIP-155 chain
 * type — the only one this product needs.
 *
 * Binary layout:
 *   version (2) | chainType (2) | chainRefLen (1) | chainRef (n) | addrLen (1) | addr (m)
 *
 * ERC 7930 is a draft, as is the ENSIP 25 key that consumes it. The Day 1
 * spike pins which representation the resolver actually expects; until then
 * both the binary form and the text form are exported and neither is assumed.
 */

export const ERC7930_VERSION = 0x0001;
export const ERC7930_CHAIN_TYPE_EIP155 = 0x0000;

function assertAddress(address: string): asserts address is Address {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error(`Not a 20-byte EVM address: ${address}`);
  }
}

function toBytes(hex: string): Uint8Array {
  const body = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function toHex(bytes: Uint8Array): Hex {
  let out = "0x";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out as Hex;
}

/** Minimal big-endian encoding of a chain id, with no leading zero bytes. */
function encodeChainReference(chainId: ChainId): Uint8Array {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error(`Chain id must be a positive integer: ${chainId}`);
  }
  const bytes: number[] = [];
  for (let value = chainId; value > 0; value = Math.floor(value / 256)) {
    bytes.unshift(value % 256);
  }
  return Uint8Array.from(bytes);
}

/** Encode an EVM address on a given chain as an ERC 7930 interoperable address. */
export function encodeInteroperableAddress(
  chainId: ChainId,
  address: string,
): Hex {
  assertAddress(address);
  const chainRef = encodeChainReference(chainId);
  const addr = toBytes(address);
  const bytes = new Uint8Array(2 + 2 + 1 + chainRef.length + 1 + addr.length);

  let offset = 0;
  bytes[offset++] = (ERC7930_VERSION >> 8) & 0xff;
  bytes[offset++] = ERC7930_VERSION & 0xff;
  bytes[offset++] = (ERC7930_CHAIN_TYPE_EIP155 >> 8) & 0xff;
  bytes[offset++] = ERC7930_CHAIN_TYPE_EIP155 & 0xff;
  bytes[offset++] = chainRef.length;
  bytes.set(chainRef, offset);
  offset += chainRef.length;
  bytes[offset++] = addr.length;
  bytes.set(addr, offset);

  return toHex(bytes);
}

/** Inverse of {@link encodeInteroperableAddress}. Throws on any other chain type. */
export function decodeInteroperableAddress(encoded: string): {
  chainId: ChainId;
  address: Address;
} {
  const bytes = toBytes(encoded);
  if (bytes.length < 6) {
    throw new Error("Interoperable address is too short to be well formed");
  }

  const version = (bytes[0] << 8) | bytes[1];
  if (version !== ERC7930_VERSION) {
    throw new Error(`Unsupported ERC 7930 version: ${version}`);
  }

  const chainType = (bytes[2] << 8) | bytes[3];
  if (chainType !== ERC7930_CHAIN_TYPE_EIP155) {
    throw new Error(`Unsupported chain type: ${chainType}`);
  }

  const chainRefLength = bytes[4];
  const chainRefEnd = 5 + chainRefLength;
  let chainId = 0;
  for (let i = 5; i < chainRefEnd; i++) chainId = chainId * 256 + bytes[i];

  const addrLength = bytes[chainRefEnd];
  const addrEnd = chainRefEnd + 1 + addrLength;
  if (addrEnd !== bytes.length) {
    throw new Error("Trailing bytes after interoperable address payload");
  }
  if (addrLength !== 20) {
    throw new Error(`Expected a 20-byte EVM address, got ${addrLength} bytes`);
  }

  return {
    chainId,
    address: toHex(bytes.subarray(chainRefEnd + 1, addrEnd)) as Address,
  };
}

/** CAIP-10 style text form, for display and for logs. */
export function formatInteroperableAddress(
  chainId: ChainId,
  address: string,
): string {
  assertAddress(address);
  return `eip155:${chainId}:${address.toLowerCase()}`;
}
