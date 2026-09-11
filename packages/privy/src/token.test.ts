import { describe, expect, it } from "vitest";
import {
  BASE_SEPOLIA_USDC,
  erc20TransferData,
  formatAmount,
  fromBaseUnits,
  toBaseUnits,
} from "./token";

/**
 * The decimals are the whole reason this file exists.
 *
 * `5` on screen and `5` on the wire differ by a factor of a million for USDC,
 * and the smaller of the two still executes, still returns a hash, and still
 * renders as a success. There is no failure mode here that announces itself.
 */

const RECIPIENT = "0xB5e8e4b8543f2B1093bDCA55A3F7Fd16f56F55C9";

describe("the token the demo pays in", () => {
  /**
   * The arithmetic itself is `@nymspace/core`'s, and tested there. What this
   * asserts is that the server and the browser are using the same one: a
   * re-export that drifted into a local copy is how the limit on screen stops
   * matching the limit on the wire.
   */
  it("denominates in the token's own decimals", () => {
    expect(toBaseUnits("5", BASE_SEPOLIA_USDC)).toBe(5_000_000n);
    expect(fromBaseUnits(5_000_000n, BASE_SEPOLIA_USDC)).toBe("5");
    expect(formatAmount("5000000", BASE_SEPOLIA_USDC)).toBe("5 USDC");
  });

  it("carries Circle's Base Sepolia deployment and six decimals", () => {
    expect(BASE_SEPOLIA_USDC.decimals).toBe(6);
    expect(BASE_SEPOLIA_USDC.address).toBe(
      "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    );
  });
});

describe("the transfer calldata is the bytes the policy reads", () => {
  /**
   * Asserted against a fixed encoding rather than against viem's own output,
   * because the policy decodes these bytes independently. If this selector or
   * argument packing is wrong, the transfer and the decision about the transfer
   * are wrong together — the shape of the mistake that looks like enforcement.
   */
  it("encodes transfer(address,uint256) with the standard selector", () => {
    const data = erc20TransferData(RECIPIENT, 5_000_000n);

    expect(data.slice(0, 10)).toBe("0xa9059cbb");
    expect(data).toBe(
      "0xa9059cbb" +
        "000000000000000000000000b5e8e4b8543f2b1093bdca55a3f7fd16f56f55c9" +
        "00000000000000000000000000000000000000000000000000000000004c4b40",
    );
  });

  it("puts the amount where the policy's transfer.amount condition looks", () => {
    const data = erc20TransferData(RECIPIENT, 1n);
    expect(BigInt(`0x${data.slice(74)}`)).toBe(1n);
  });
});
