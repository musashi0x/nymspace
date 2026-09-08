import { describe, expect, it } from "vitest";
import {
  decodeInteroperableAddress,
  encodeInteroperableAddress,
  formatInteroperableAddress,
} from "./erc7930";

const SEPOLIA = 11155111;
const ADDRESS = "0x0000000000000000000000000000000000000001";

describe("ERC 7930 interoperable addresses", () => {
  it("lays the payload out as version, chain type, chain reference, address", () => {
    // 0001 version | 0000 eip155 | 03 length | aa36a7 = 11155111 | 14 = 20 bytes
    expect(encodeInteroperableAddress(SEPOLIA, ADDRESS)).toBe(
      "0x0001000003aa36a7140000000000000000000000000000000000000001",
    );
  });

  it("round-trips", () => {
    const encoded = encodeInteroperableAddress(SEPOLIA, ADDRESS);
    expect(decodeInteroperableAddress(encoded)).toEqual({
      chainId: SEPOLIA,
      address: ADDRESS,
    });
  });

  it("encodes the chain reference minimally, with no leading zero bytes", () => {
    // Mainnet is chain 1, so one byte, not four.
    expect(encodeInteroperableAddress(1, ADDRESS)).toContain("00000101");
  });

  it("rejects a value that is not a 20-byte address", () => {
    expect(() => encodeInteroperableAddress(SEPOLIA, "0xdeadbeef")).toThrow(
      /not a 20-byte evm address/i,
    );
  });

  it("rejects a non-positive chain id", () => {
    expect(() => encodeInteroperableAddress(0, ADDRESS)).toThrow(
      /positive integer/i,
    );
  });

  it("rejects trailing bytes rather than decoding a prefix", () => {
    const encoded = encodeInteroperableAddress(SEPOLIA, ADDRESS);
    expect(() => decodeInteroperableAddress(`${encoded}ff`)).toThrow(
      /trailing bytes/i,
    );
  });

  it("rejects an unsupported version", () => {
    expect(() =>
      decodeInteroperableAddress(
        "0x9999000003aa36a7140000000000000000000000000000000000000001",
      ),
    ).toThrow(/unsupported erc 7930 version/i);
  });

  it("formats the text form in CAIP-10 shape", () => {
    expect(formatInteroperableAddress(SEPOLIA, ADDRESS)).toBe(
      `eip155:${SEPOLIA}:${ADDRESS}`,
    );
  });
});
