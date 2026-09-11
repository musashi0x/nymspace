import { describe, expect, it } from "vitest";
import { formatAmount, fromBaseUnits, toBaseUnits, type TokenSpec } from "./units";

/**
 * Six decimals and eighteen decimals, one code path.
 *
 * The demo's two numbers are `5` and `100`, and the failure mode is that the
 * small version of either one executes and reports success. Nothing here can
 * announce itself at runtime, so it is pinned in a test instead.
 */

const USDC: TokenSpec = {
  address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  symbol: "USDC",
  decimals: 6,
};

describe("display units to base units", () => {
  it("scales by the token's decimals", () => {
    expect(toBaseUnits("5", USDC)).toBe(5_000_000n);
    expect(toBaseUnits("100", USDC)).toBe(100_000_000n);
  });

  it("scales native amounts by eighteen", () => {
    expect(toBaseUnits("1", null)).toBe(10n ** 18n);
  });

  it("keeps a fraction exactly", () => {
    expect(toBaseUnits("5.25", USDC)).toBe(5_250_000n);
    expect(toBaseUnits("0.000001", USDC)).toBe(1n);
  });

  it("refuses more precision than the token has", () => {
    // Truncating would send a different amount than the operator typed.
    expect(() => toBaseUnits("5.0000001", USDC)).toThrow(/decimal places/);
  });

  it("refuses anything that is not a decimal amount", () => {
    expect(() => toBaseUnits("5 USDC", USDC)).toThrow();
    expect(() => toBaseUnits("-5", USDC)).toThrow();
    expect(() => toBaseUnits("", USDC)).toThrow();
  });
});

describe("base units to display units", () => {
  it("round-trips", () => {
    for (const amount of ["0", "1", "5.25", "100", "0.000001"]) {
      expect(fromBaseUnits(toBaseUnits(amount, USDC), USDC)).toBe(amount);
    }
  });

  it("does not confuse six decimals with eighteen", () => {
    expect(fromBaseUnits(100_000_000n, USDC)).toBe("100");
    expect(fromBaseUnits(100_000_000n, null)).toBe("0.0000000001");
  });

  it("survives an amount larger than Number can hold", () => {
    const huge = "115792089237316195423570985008687907853269984665640564039457";
    expect(fromBaseUnits(toBaseUnits(huge, USDC), USDC)).toBe(huge);
  });

  it("names the unit when it formats", () => {
    expect(formatAmount("5000000", USDC)).toBe("5 USDC");
    expect(formatAmount("5000000000000000000", null)).toBe("5 ETH");
  });
});
