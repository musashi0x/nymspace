import { encodeFunctionData, type Address } from "viem";
import type { TokenSpec } from "@nymspace/core";

/**
 * The token the demo pays in, and the bytes a payment carries.
 *
 * The arithmetic lives in `@nymspace/core` rather than here, because the
 * console does the same conversions in the browser and this package is
 * `server-only`. A limit formatted one way on the server and another way on the
 * screen is the failure this split prevents: there is one implementation, and
 * both sides import it.
 */

export {
  NATIVE_DECIMALS,
  formatAmount,
  fromBaseUnits,
  toBaseUnits,
  type TokenSpec,
  type TokenUnits,
} from "@nymspace/core";

/** The ERC 20 surface the policy and the encoder share — one function. */
export const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recipient", type: "address", internalType: "address" },
      { name: "amount", type: "uint256", internalType: "uint256" },
    ],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
  },
] as const;

/**
 * Kept in the shape Privy's policy API wants — plain JSON, `inputs`/`outputs`
 * with `internalType` — rather than reusing the viem const above. viem's ABI
 * types are readonly, and a readonly array serialises identically but does not
 * typecheck as the mutable `unknown[]` a request body wants. The duplication is
 * two field names wide and the alternative is a cast at the boundary where the
 * policy is built, which is the last place to lose type checking.
 */
export const ERC20_TRANSFER_ABI_JSON = [
  {
    inputs: [
      { internalType: "address", name: "recipient", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
];

/**
 * Base Sepolia USDC — Circle's own testnet deployment.
 *
 * Named rather than inlined at the call site so that the one place a reader
 * checks this address against Circle's documentation is the one place it
 * appears. `docs/20_SOURCES.md` requires the recheck before submission.
 */
export const BASE_SEPOLIA_USDC: TokenSpec = {
  address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  symbol: "USDC",
  decimals: 6,
};

/**
 * The calldata a token payment carries.
 *
 * Split out from the client so the gate can assert it against a known-good
 * encoding: the transaction Privy signs and the calldata Privy's policy decodes
 * are the same bytes, and if this function is wrong both are wrong in the same
 * direction — a payment that looks enforced and transfers nothing.
 */
export function erc20TransferData(recipient: Address, amount: bigint): `0x${string}` {
  return encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: "transfer",
    args: [recipient, amount],
  });
}
