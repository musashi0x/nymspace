import type { Address } from "./types";

/**
 * Token amounts and the units they are in.
 *
 * Pure, and in the unguarded package on purpose: the console renders a limit
 * and parses an input, and it must do that with the same arithmetic the server
 * uses. A browser that formats six-decimal USDC as though it were wei shows
 * `0.0000000001` next to a policy that says `100`, and nothing errors.
 *
 * Every function here is integer string arithmetic. No `Number`, anywhere —
 * `Number("115792089237316195423570985008687907853269984665640564039457")`
 * is a rounded approximation that still compares, still renders, and is wrong.
 */

export interface TokenSpec {
  address: Address;
  symbol: string;
  decimals: number;
}

/**
 * What the arithmetic actually needs.
 *
 * Narrower than {@link TokenSpec} on purpose: an amount is scaled by decimals
 * and labelled by symbol, and the address plays no part. Taking the whole spec
 * would force the console to brand an address it received as JSON before it
 * could format a number with it — a cast at the boundary, to satisfy a
 * parameter that never reads the field.
 */
export type TokenUnits = Pick<TokenSpec, "symbol" | "decimals">;

/** Native ETH, for the path where no token is configured. */
export const NATIVE_DECIMALS = 18;

function decimalsOf(token: TokenUnits | null): number {
  return token?.decimals ?? NATIVE_DECIMALS;
}

/**
 * Display units → base units. `"5"` + USDC → `5000000n`.
 *
 * Throws on more decimal places than the token has, rather than truncating:
 * silently dropping the tail of `5.0000001 USDC` sends a different amount than
 * the operator typed, which is the one class of mistake this module exists to
 * make impossible.
 */
export function toBaseUnits(amount: string, token: TokenUnits | null): bigint {
  const decimals = decimalsOf(token);
  const trimmed = amount.trim();

  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`"${amount}" is not a non-negative decimal amount`);
  }

  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    throw new Error(
      `${amount} has ${fraction.length} decimal places but ${
        token?.symbol ?? "ETH"
      } has ${decimals}. Rounding here would send an amount nobody typed.`,
    );
  }

  return BigInt(`${whole}${fraction.padEnd(decimals, "0")}`);
}

/** Base units → display units. `5000000` + USDC → `"5"`. */
export function fromBaseUnits(
  amount: bigint | string,
  token: TokenUnits | null,
): string {
  const decimals = decimalsOf(token);
  const value = BigInt(amount);
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, "0");

  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals === 0 ? "" : digits.slice(digits.length - decimals).replace(/0+$/, "");

  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/** `5000000` + USDC → `5 USDC`. The unit is never left to the reader. */
export function formatAmount(
  amount: bigint | string,
  token: TokenUnits | null,
): string {
  return `${fromBaseUnits(amount, token)} ${token?.symbol ?? "ETH"}`;
}
